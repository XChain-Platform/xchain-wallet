// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const SOURCE = resolve('packages/mobile/scripts/wear-acceptance.sh');
const NOTIFY_SOURCE = resolve('packages/mobile/scripts/dumpsys-notify.js');
const fixtureRoot = resolve('tmp');
const fixtures = [];

afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe('wear-acceptance.sh', () => {
    it.each(['balances', 'alerts', 'privacy'])('builds, installs, and drives the %s case', (caseName) => {
        const fixture = makeFixture();
        const result = run(fixture, caseName);
        const commands = readFileSync(fixture.log, 'utf8');

        expect(result.status, result.stderr).toBe(0);
        expect(commands).toContain('gradle -p packages/mobile/android :app:assembleDebug :app:assembleDebugAndroidTest :wear:assembleDebug');
        expect(commands).toContain('adb -s PHONE install -r packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk');
        expect(commands).toContain('adb -s WATCH install -r packages/mobile/android/wear/build/outputs/apk/debug/wear-debug.apk');
        expect(commands).toContain(`WatchAcceptanceDriverTest#${caseName}`);
        expect(commands).toContain('shell uiautomator dump /sdcard/xchain-wear.xml');
        expect(commands).toContain('shell input tap');
        if (caseName === 'alerts') {
            expect(commands).toContain('shell dumpsys notification');
            expect(commands).toContain('io.xchain.wallet.android.wear.DEBUG_SURFACE --es surface complication');
            expect(commands).toContain('io.xchain.wallet.android.wear.DEBUG_SURFACE --es surface tile');
        }
    });

    it('discovers the phone and watch and reads every expected W1 line', () => {
        const fixture = makeFixture();
        const result = run(fixture, 'balances', { WEAR_PHONE_SERIAL: '', WEAR_WATCH_SERIAL: '' });
        const commands = readFileSync(fixture.log, 'utf8');

        expect(result.status, result.stderr).toBe(0);
        expect(commands).toContain('adb devices -l');
        expect(commands).toContain('adb -s PHONE shell getprop ro.build.characteristics');
        expect(commands).toContain('adb -s WATCH shell getprop ro.build.characteristics');
        for (const line of ['Balances', 'Token 01 $1.00', 'Token 50 $50.00']) {
            expect(commands).not.toContain(`missing ${line}`);
        }
    });

    it('exits 1 naming the first missing expected line', () => {
        const fixture = makeFixture();
        const result = run(fixture, 'balances', {
            FAKE_MISSING_LINE: 'Token 01 $1.00',
            WEAR_ACCEPTANCE_TIMEOUT_SECONDS: '0',
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('wear-acceptance: missing Token 01 $1.00');
        expect(result.stderr).not.toContain('Token 50 $50.00');
    });

    it('rejects an unknown case before invoking tools', () => {
        const fixture = makeFixture();
        const result = run(fixture, 'unknown');

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('{balances|alerts|privacy}');
        expect(readFileSync(fixture.log, 'utf8')).toBe('');
    });
});

function makeFixture() {
    mkdirSync(fixtureRoot, { recursive: true });
    const root = mkdtempSync(join(fixtureRoot, 'wear-acceptance-'));
    fixtures.push(root);
    const bin = join(root, 'bin');
    const log = join(root, 'commands.log');
    put(join(root, 'packages/mobile/scripts/wear-acceptance.sh'), readFileSync(SOURCE), 0o755);
    put(join(root, 'packages/mobile/scripts/dumpsys-notify.js'), readFileSync(NOTIFY_SOURCE));
    put(join(root, 'package.json'), '{"type":"module"}\n');
    put(join(root, 'test/fixtures/watch/expected/balances.json'), JSON.stringify({
        'snapshot-rows50': {
            fiat: { header: 'Balances', rows: ['Token 01 $1.00', 'Token 50 $50.00'] },
        },
    }));
    put(log, '');
    put(join(bin, 'gradle'), '#!/usr/bin/env bash\nprintf "gradle %s\\n" "$*" >> "$FAKE_COMMAND_LOG"\n', 0o755);
    put(join(bin, 'adb'), fakeAdb, 0o755);
    return { root, bin, log };
}

function run(fixture, caseName, overrides = {}) {
    return spawnSync('/bin/bash', ['packages/mobile/scripts/wear-acceptance.sh', caseName], {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
            ...process.env,
            FAKE_COMMAND_LOG: fixture.log,
            PATH: `${fixture.bin}:${process.env.PATH}`,
            WEAR_PHONE_SERIAL: 'PHONE',
            WEAR_WATCH_SERIAL: 'WATCH',
            ...overrides,
        },
    });
}

function put(path, contents, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    if (mode) chmodSync(path, mode);
}

const fakeAdb = `#!/usr/bin/env bash
printf 'adb %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
if [ "$1" = devices ]; then
    printf 'List of devices attached\\nPHONE device product:phone\\nWATCH device product:watch\\n'
elif [ "$3 $4 $5" = 'shell getprop ro.build.characteristics' ]; then
    [ "$2" = WATCH ] && printf 'watch\\n' || printf 'phone\\n'
elif [ "$3 $4" = 'shell cat' ]; then
    line='Token 01 $1.00'
    [ "\${FAKE_MISSING_LINE:-}" = "$line" ] && line=''
    printf '<hierarchy text="Balances %s Token 50 $50.00 7-day price line xch1acceptanceaddress123 complication text 1 alert Tile text 1 alert •••• Show wallet on watch is off on your phone Watch acceptance alert"/>\\n' "$line"
elif [ "$3 $4 $5" = 'shell dumpsys notification' ]; then
    printf '%s\\n' 'NotificationRecord(1: pkg=io.xchain.wallet.android.debug user=u: Notification(channel=alert))'
    printf '%s\\n' '  extras={' '    android.title=String (Watch acceptance alert)' '  }'
    printf '%s\\n' 'NotificationRecord(2: pkg=io.xchain.wallet.android.debug user=u: Notification(channel=payment))'
    printf '%s\\n' '  extras={' '    android.title=String (Payment due)' '  }' '  actions={' '    [0] "Open on phone" -> PendingIntent{1}' '  }'
fi
`;
