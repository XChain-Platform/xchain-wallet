// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn, spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const scriptSource = readFileSync(join(root, 'packages/mobile/scripts/wear-pair.sh'), 'utf8');
const uiDumpSource = readFileSync(join(root, 'packages/mobile/scripts/ui-dump.js'), 'utf8');
const androidTest = readFileSync(
    join(root, 'packages/mobile/android/app/src/androidTest/java/io/xchain/wallet/android/watch/WatchPairedTest.java'),
    'utf8',
);
const fixtureRoot = join(root, 'tmp');
const fixtures = [];

afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
        const startedAvds = ['xc-phone-play', 'xc-wear-large-round'].filter((avd) => {
            const path = join(fixture.root, `tmp/watch-sim/wear-pair-${avd}.pid`);
            return existsSync(path);
        });
        run(fixture, ['--stop']);
        await expect.poll(() => startedAvds.every(
            (avd) => lines(fixture.log).some((line) => line.includes(`emulator-stopped -avd ${avd} `)),
        )).toBe(true);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        rmSync(fixture.root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
});

describe('wear-pair.sh', () => {
    it('drives attached-device forwarding and companion UI pairing before instrumentation', () => {
        const fixture = makeFixture();
        const result = run(fixture, ['--device']);
        const commands = lines(fixture.log);

        expect(result.status).toBe(0);
        expect(commands).toContain('adb -d get-serialno');
        expect(commands).toContain('adb -s LGK500 shell getprop ro.product.model');
        expect(commands).toContain('adb -s LGK500 forward tcp:5601 tcp:5601');
        expect(commands.filter((line) => line.includes('uiautomator dump'))).toHaveLength(2);
        expect(commands.filter((line) => line.includes('xchain-wear-pair.xml'))).toHaveLength(4);
        expect(commands).toContain('adb -s LGK500 shell input tap 60 70');
        expect(commands).toContain('adb -s LGK500 shell input tap 300 400');
        expect(commands).toContain('watch-test gradle :app:assembleDebug :app:assembleDebugAndroidTest :wear:assembleDebug');
        expect(commands.some((line) => line.includes('WatchPairedTest'))).toBe(true);
        expect(commands.some((line) => line.includes('-avd xc-phone-play'))).toBe(false);
        expect(commands.some((line) => line.includes('-avd xc-wear-large-round -port 5570'))).toBe(true);
    });

    it('creates and boots the fallback phone AVD, then forwards through it', () => {
        const fixture = makeFixture();
        const result = run(fixture);
        const commands = lines(fixture.log);

        expect(result.status).toBe(0);
        expect(commands).toContain('sdkmanager --install system-images;android-36;google_apis_playstore;arm64-v8a');
        expect(commands).toContain('avdmanager create avd -n xc-phone-play -k system-images;android-36;google_apis_playstore;arm64-v8a -d pixel_6');
        expect(commands.some((line) => line.includes('-avd xc-phone-play -port 5560'))).toBe(true);
        expect(commands).toContain('adb -s emulator-5560 forward tcp:5601 tcp:5601');
    });

    it('records every emulator pid and --stop terminates only those processes', async () => {
        const fixture = makeFixture();
        expect(run(fixture).status).toBe(0);
        const pidPaths = ['xc-phone-play', 'xc-wear-large-round'].map(
            (avd) => join(fixture.root, `tmp/watch-sim/wear-pair-${avd}.pid`),
        );
        const pids = pidPaths.map((path) => Number(readFileSync(path, 'utf8')));
        const unrelated = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });

        expect(pids.every(alive)).toBe(true);
        expect(run(fixture, ['--stop']).status).toBe(0);
        await expect.poll(() => {
            const commands = lines(fixture.log);
            return ['xc-phone-play', 'xc-wear-large-round'].every(
                (avd) => commands.some((line) => line.includes(`emulator-stopped -avd ${avd} `)),
            );
        }).toBe(true);
        expect(pidPaths.every((path) => !existsSync(path))).toBe(true);
        expect(alive(unrelated.pid)).toBe(true);
        unrelated.kill();
    });

    it.each([
        [{ companion: false }, 'missing Wear OS companion app'],
        [{ signIn: false }, 'missing Google sign-in'],
        [{ model: 'Pixel 9' }, 'attached device is not the LG K500'],
    ])('names an unavailable device prerequisite', (options, message) => {
        const fixture = makeFixture(options);
        const result = run(fixture, ['--device']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(message);
    });

    it('rejects broad process termination and proves the Android capability predicate', () => {
        expect(scriptSource).not.toMatch(/pkill|killall|adb kill-server/);
        for (const value of [
            'getConnectedNodes()',
            'node.isNearby()',
            'getCapability(',
            'CapabilityClient.FILTER_REACHABLE',
            '"xchain_wear"',
        ]) expect(androidTest).toContain(value);
    });
});

function makeFixture(options = {}) {
    mkdirSync(fixtureRoot, { recursive: true });
    const fixture = {
        root: mkdtempSync(join(fixtureRoot, 'wear-pair-')),
        companion: options.companion ?? true,
        signIn: options.signIn ?? true,
        model: options.model ?? 'LG K500',
    };
    fixtures.push(fixture);
    fixture.sdk = join(fixture.root, 'android-sdk');
    fixture.bin = join(fixture.root, 'bin');
    fixture.log = join(fixture.root, 'tmp/commands.log');
    fixture.script = join(fixture.root, 'packages/mobile/scripts/wear-pair.sh');

    put(fixture.script, scriptSource, 0o755);
    put(join(fixture.root, 'packages/mobile/scripts/ui-dump.js'), uiDumpSource);
    put(join(fixture.root, 'package.json'), '{"type":"module"}\n');
    put(fixture.log, '');
    put(join(fixture.root, 'packages/mobile/scripts/watch-test.sh'), `#!/usr/bin/env bash
printf 'watch-test %s\\n' "$*" >> "$COMMAND_LOG"
`, 0o755);
    put(join(fixture.sdk, 'emulator/emulator'), `#!/usr/bin/env bash
printf 'emulator %s\\n' "$*" >> "$COMMAND_LOG"
trap 'printf "emulator-stopped %s\\n" "$*" >> "$COMMAND_LOG"; exit 0' TERM INT
while :; do sleep 1 & wait $!; done
`, 0o755);
    put(join(fixture.bin, 'ps'), `#!/usr/bin/env bash
pid="$2"
for avd in xc-phone-play xc-wear-large-round; do
  file="$FIXTURE_ROOT/tmp/watch-sim/wear-pair-$avd.pid"
  if [ -f "$file" ] && [ "$(tr -dc '0-9' < "$file")" = "$pid" ]; then
    printf '%s -avd %s\\n' "$XCHAIN_ANDROID_SDK/emulator/emulator" "$avd"
  fi
done
`, 0o755);
    put(join(fixture.sdk, 'cmdline-tools/latest/bin/sdkmanager'), `#!/usr/bin/env bash
printf 'sdkmanager %s\\n' "$*" >> "$COMMAND_LOG"
`, 0o755);
    put(join(fixture.sdk, 'cmdline-tools/latest/bin/avdmanager'), `#!/usr/bin/env bash
printf 'avdmanager %s\\n' "$*" >> "$COMMAND_LOG"
`, 0o755);
    put(join(fixture.sdk, 'platform-tools/adb'), `#!/usr/bin/env bash
printf 'adb %s\\n' "$*" >> "$COMMAND_LOG"
if [ "$1 $2" = '-d get-serialno' ]; then printf 'LGK500\\n'; exit 0; fi
case "$*" in
  *' emu avd name') exit 1 ;;
  *'-s emulator-5560 wait-for-device')
    until grep -Fq -- '-avd xc-phone-play ' "$COMMAND_LOG"; do sleep 0.01; done
    ;;
  *'-s emulator-5570 wait-for-device')
    until grep -Fq -- '-avd xc-wear-large-round ' "$COMMAND_LOG"; do sleep 0.01; done
    ;;
  *' shell getprop sys.boot_completed') printf '1\\n' ;;
  *' shell getprop ro.product.model') printf '%s\\n' "$DEVICE_MODEL" ;;
  *' shell pm path com.google.android.wearable.app')
    [ "$HAS_COMPANION" = 1 ] || exit 1
    printf 'package:wear.apk\\n'
    ;;
  *' shell dumpsys account') [ "$HAS_SIGN_IN" = 1 ] && printf 'type=com.google\\n' ;;
  *' shell cat /sdcard/xchain-wear-pair.xml')
    printf '%s\\n' '<hierarchy><node text="Pair with emulator" bounds="[10,20][110,120]"/><node text="Pair" bounds="[200,300][400,500]"/></hierarchy>'
    ;;
  *' shell am instrument '*) printf 'OK (1 test)\\n' ;;
esac
`, 0o755);
    return fixture;
}

function run(fixture, args = []) {
    return spawnSync('/bin/bash', [fixture.script, ...args], {
        cwd: fixture.root,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
            ...process.env,
            COMMAND_LOG: fixture.log,
            DEVICE_MODEL: fixture.model,
            HAS_COMPANION: fixture.companion ? '1' : '0',
            HAS_SIGN_IN: fixture.signIn ? '1' : '0',
            FIXTURE_ROOT: fixture.root,
            PATH: `${fixture.bin}:${process.env.PATH}`,
            XCHAIN_ANDROID_SDK: fixture.sdk,
        },
    });
}

function alive(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

function lines(path) {
    return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
}

function put(path, contents, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    if (mode) chmodSync(path, mode);
}
