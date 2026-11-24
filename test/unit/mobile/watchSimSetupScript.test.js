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

const SOURCE = resolve(process.cwd(), 'packages/mobile/scripts/watch-sim-setup.sh');
const source = readFileSync(SOURCE, 'utf8');
const fixtureRoot = resolve(process.cwd(), 'tmp');
const fixtures = [];

afterEach(() => {
    for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe('watch-sim-setup.sh', () => {
    it('pins the simulator names, device types, image, profiles, and commands', () => {
        for (const value of [
            'XC iPhone 17',
            'XC Watch 41mm',
            'XC Watch 49mm',
            'XC iPhone Duo',
            'iPhone-17',
            'Apple-Watch-Series-9-41mm',
            'Apple-Watch-Ultra-4-49mm',
            'iPhone-Duo',
            'system-images;android-36;android-wear-signed;arm64-v8a',
            'xc-wear-small-round',
            'wearos_small_round',
            '192',
            'xc-wear-large-round',
            'wearos_large_round',
            '227',
            '/opt/homebrew/share/android-commandlinetools',
            '/opt/homebrew/opt/openjdk@21',
            '-downloadPlatform',
            'pair_activate',
            '--boot-wear',
            '--stop-wear',
        ]) expect(source).toContain(value);
        expect(source).not.toContain('Library/Android/sdk');
        expect(source).not.toContain('ANDROID_HOME');
    });

    it('installs Android tools before validating the emulator and tolerates no Duo runtime', () => {
        const fixture = makeFixture({ emulator: false, installEmulator: true, avds: false });
        const result = run(fixture);

        expect(result.status).toBe(0);
        expect(result.stdout.match(/duo: no runtime supports iPhone-Duo/g)).toHaveLength(1);
        const commands = readFileSync(fixture.log, 'utf8');
        expect(commands).toContain(
            `sdkmanager --sdk_root=${fixture.sdk} platform-tools emulator system-images;android-36;android-wear-signed;arm64-v8a`,
        );
        expect(commands).toContain(
            'avdmanager create avd --force --name xc-wear-small-round --package system-images;android-36;android-wear-signed;arm64-v8a --device wearos_small_round',
        );
        expect(commands).toContain(
            'avdmanager create avd --force --name xc-wear-large-round --package system-images;android-36;android-wear-signed;arm64-v8a --device wearos_large_round',
        );
        expect(commands).not.toContain('simctl create');
        expect(commands).not.toContain('simctl pair WATCH');
        expect(commands).not.toContain('xcodebuild');
    });

    it('creates the Apple devices and both switchable watch pairs', () => {
        const fixture = makeFixture({ devices: false, pairs: false });
        const result = run(fixture);

        expect(result.status).toBe(0);
        const commands = readFileSync(fixture.log, 'utf8');
        expect(commands).toContain(
            'simctl create XC iPhone 17 com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-2',
        );
        expect(commands).toContain(
            'simctl create XC Watch 41mm com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-9-41mm com.apple.CoreSimulator.SimRuntime.watchOS-27-2',
        );
        expect(commands).toContain(
            'simctl create XC Watch 49mm com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-4-49mm com.apple.CoreSimulator.SimRuntime.watchOS-27-2',
        );
        expect(commands).toContain('simctl pair WATCH-SMALL PHONE-17');
        expect(commands).toContain('simctl pair WATCH-LARGE PHONE-17');
        expect(commands).toContain('simctl pair_activate PAIR-SMALL');
        expect(commands).toContain('simctl pair_activate PAIR-LARGE');
    });

    it('names every missing required piece while keeping Duo out of the main check', () => {
        const fixture = makeFixture({
            runtimes: false,
            devices: false,
            pairs: false,
            emulator: false,
            image: false,
            avds: false,
            malformed: true,
        });
        const result = run(fixture, ['--check']);

        expect(result.status).toBe(1);
        for (const value of [
            'runtime: missing iOS 27.2',
            'runtime: missing watchOS 27.2',
            'device: XC iPhone 17 must use com.apple.CoreSimulator.SimDeviceType.iPhone-17',
            'device: XC Watch 41mm must use com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-9-41mm',
            'device: XC Watch 49mm must use com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-4-49mm',
            'pair: missing XC iPhone 17 + XC Watch 41mm',
            'pair: missing XC iPhone 17 + XC Watch 49mm',
            `android: missing emulator at ${fixture.sdk}/emulator/emulator`,
            'android: missing image system-images;android-36;android-wear-signed;arm64-v8a',
            'android: missing AVD xc-wear-small-round',
            'android: missing AVD xc-wear-large-round',
        ]) expect(result.stderr).toContain(value);
        expect(result.stderr).not.toContain('Duo');
    });

    it('passes the main check without Duo and gates Duo separately', () => {
        const fixture = makeFixture();
        const main = run(fixture, ['--check']);
        const duo = run(fixture, ['--check', 'duo']);

        expect(main.status).toBe(0);
        expect(main.stdout + main.stderr).not.toContain('Duo');
        expect(duo.status).toBe(1);
        expect(duo.stdout).toBe('duo: no runtime supports iPhone-Duo\n');
        expect(duo.stderr).toBe('');
    });

    it('rejects and repairs same-name devices and AVDs with the wrong configurations', () => {
        const fixture = makeFixture({
            deviceTypes: false,
            smallProfile: false,
            largeProfile: false,
            smallImage: false,
            largeImage: false,
        });
        const result = run(fixture, ['--check']);

        expect(result.status).toBe(1);
        for (const value of [
            'device: XC iPhone 17 must use com.apple.CoreSimulator.SimDeviceType.iPhone-17',
            'device: XC Watch 41mm must use com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-9-41mm',
            'device: XC Watch 49mm must use com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-4-49mm',
            'pair: missing XC iPhone 17 + XC Watch 41mm',
            'pair: missing XC iPhone 17 + XC Watch 49mm',
            'android: AVD xc-wear-small-round hw.device.name expected wearos_small_round, found pixel_9',
            'android: AVD xc-wear-large-round hw.device.name expected wearos_large_round, found pixel_9',
            'android: AVD xc-wear-small-round image.sysdir.1 expected system-images/android-36/android-wear-signed/arm64-v8a/',
            'android: AVD xc-wear-large-round image.sysdir.1 expected system-images/android-36/android-wear-signed/arm64-v8a/',
        ]) expect(result.stderr).toContain(value);

        expect(run(fixture).status).toBe(0);
        const commands = readFileSync(fixture.log, 'utf8');
        expect(commands).toContain(
            'simctl create XC iPhone 17 com.apple.CoreSimulator.SimDeviceType.iPhone-17',
        );
        expect(commands).toContain(
            'avdmanager create avd --force --name xc-wear-small-round',
        );
        expect(commands).toContain(
            'avdmanager create avd --force --name xc-wear-large-round',
        );
    });

    it('rejects watches created under a runtime that does not support their device type', () => {
        const fixture = makeFixture({ watchRuntime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-2' });
        const result = run(fixture, ['--check']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('device: XC Watch 41mm must use com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-9-41mm');
        expect(result.stderr).toContain('device: XC Watch 49mm must use com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-4-49mm');
        expect(result.stderr).toContain('on com.apple.CoreSimulator.SimRuntime.iOS-27-2');
        expect(result.stderr).toContain('pair: missing XC iPhone 17 + XC Watch 41mm');
    });

    it('repairs without SIGPIPE when the manager fills the pipe', () => {
        expect(source).not.toMatch(/(?<!\|)\|(?!\|)\s*"\$avdmanager"/);
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const fixture = makeFixture({
                smallProfile: false,
                largeProfile: false,
                managerTrailingLines: 20000,
            });
            const result = run(fixture);

            expect(result.status).toBe(0);
            const commands = readFileSync(fixture.log, 'utf8');
            expect(commands).toContain(
                'avdmanager create avd --force --name xc-wear-small-round',
            );
            expect(commands).toContain(
                'avdmanager create avd --force --name xc-wear-large-round',
            );
        }
    });

    it.each([
        ['small', { smallDimensions: false }, 'xc-wear-small-round', '192 dp'],
        ['large', { largeDimensions: false }, 'xc-wear-large-round', '227 dp'],
    ])('rejects a wrong %s AVD logical dimension', (_size, options, name, dp) => {
        const fixture = makeFixture(options);
        const result = run(fixture, ['--check']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`android: AVD ${name} logical size expected ${dp}`);
    });

    it('boots named headless AVDs on fixed ports, waits for them, and stops recorded pids', async () => {
        const fixture = makeFixture({ adbStateAfter: 3, adbBootAfter: 2 });
        const small = run(fixture, ['--boot-wear', 'small']);
        const large = run(fixture, ['--boot-wear', 'large']);

        expect(small.status).toBe(0);
        expect(small.stdout).toBe('emulator-5572\n');
        expect(large.status).toBe(0);
        expect(large.stdout).toBe('emulator-5570\n');
        const smallPid = join(fixture.root, 'tmp/watch-sim/small.pid');
        const largePid = join(fixture.root, 'tmp/watch-sim/large.pid');
        expect(readFileSync(smallPid, 'utf8')).toMatch(/^\d+\n$/);
        expect(readFileSync(largePid, 'utf8')).toMatch(/^\d+\n$/);
        await expect.poll(() => readFileSync(fixture.log, 'utf8')).toContain(
            'emulator -avd xc-wear-large-round -no-window -no-audio -no-snapshot -port 5570',
        );
        const stopped = run(fixture, ['--stop-wear']);
        expect(stopped.status).toBe(0);
        expect(() => readFileSync(smallPid)).toThrow();
        expect(() => readFileSync(largePid)).toThrow();
        const commands = readFileSync(fixture.log, 'utf8');
        expect(commands).toContain('emulator -avd xc-wear-small-round -no-window -no-audio -no-snapshot -port 5572');
        expect(commands).toContain('adb -s emulator-5572 get-state');
        expect(commands).toContain('adb -s emulator-5572 shell getprop sys.boot_completed');
        expect(commands).toContain('adb -s emulator-5570 get-state');
        expect(commands).toContain('adb -s emulator-5570 shell getprop sys.boot_completed');
        expect(commands.match(/adb -s emulator-5572 get-state/g)).toHaveLength(4);
        expect(commands.match(/adb -s emulator-5572 shell getprop sys.boot_completed/g)).toHaveLength(2);
    });

    it('caps the Wear boot wait at 180 seconds', () => {
        expect(source).toContain('${WATCH_SIM_BOOT_TIMEOUT_SECONDS:-180}');
        const fixture = makeFixture({ adbStateAfter: 999, bootTimeout: 1 });
        const result = run(fixture, ['--boot-wear', 'small']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
            'android: emulator-5572 did not reach device and complete boot within 1 seconds',
        );
        expect(run(fixture, ['--stop-wear']).status).toBe(0);
    });
});

function makeFixture(options = {}) {
    const settings = {
        runtimes: true,
        devices: true,
        deviceTypes: true,
        pairs: true,
        emulator: true,
        installEmulator: false,
        image: true,
        avds: true,
        smallProfile: true,
        largeProfile: true,
        smallImage: true,
        largeImage: true,
        smallDimensions: true,
        largeDimensions: true,
        adbStateAfter: 1,
        adbBootAfter: 1,
        bootTimeout: 180,
        malformed: false,
        managerTrailingLines: 0,
        watchRuntime: undefined,
        ...options,
    };
    mkdirSync(fixtureRoot, { recursive: true });
    const root = mkdtempSync(join(fixtureRoot, 'watch-sim-'));
    fixtures.push(root);
    const script = join(root, 'packages/mobile/scripts/watch-sim-setup.sh');
    const bin = join(root, 'bin');
    const sdk = join(root, 'sdk');
    const log = join(root, 'commands.log');
    const runtimes = join(root, 'runtimes.json');
    const devices = join(root, 'devices.json');
    const pairs = join(root, 'pairs.json');
    const emulator = join(sdk, 'emulator/emulator');
    const emulatorTemplate = join(root, 'emulator-template');

    put(script, source, 0o755);
    put(log, '');
    put(runtimes, settings.malformed ? '' : JSON.stringify(runtimeData(settings.runtimes)));
    put(devices, settings.malformed ? '' : JSON.stringify(deviceData(settings.devices, settings.deviceTypes, settings.watchRuntime)));
    put(pairs, settings.malformed ? '' : JSON.stringify(pairData(settings.pairs)));
    put(join(bin, 'xcrun'), xcrunStub(), 0o755);
    put(join(bin, 'xcodebuild'), commandStub('xcodebuild'), 0o755);
    put(join(sdk, 'cmdline-tools/latest/bin/sdkmanager'), sdkmanagerStub(), 0o755);
    put(join(sdk, 'cmdline-tools/latest/bin/avdmanager'), avdmanagerStub(), 0o755);
    put(join(sdk, 'platform-tools/adb'), adbStub(), 0o755);
    put(emulatorTemplate, emulatorStub(), 0o755);
    if (settings.emulator) put(emulator, emulatorStub(), 0o755);
    if (settings.avds) {
        put(join(root, 'avd/xc-wear-small-round.avd/config.ini'), avdConfig(
            settings.smallProfile ? 'wearos_small_round' : 'pixel_9',
            settings.smallImage,
            settings.smallDimensions ? 192 : 191,
        ));
        put(join(root, 'avd/xc-wear-large-round.avd/config.ini'), avdConfig(
            settings.largeProfile ? 'wearos_large_round' : 'pixel_9',
            settings.largeImage,
            settings.largeDimensions ? 227 : 226,
        ));
    }

    return { root, script, bin, sdk, log, runtimes, devices, pairs, emulator, emulatorTemplate, settings };
}

function run(fixture, args = []) {
    return spawnSync('/bin/bash', [fixture.script, ...args], {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
            ...process.env,
            ANDROID_AVD_HOME: join(fixture.root, 'avd'),
            FAKE_AVDS: fixture.settings.avds ? '1' : '0',
            FAKE_ADB_STATE_AFTER: fixture.settings.adbStateAfter,
            FAKE_ADB_BOOT_AFTER: fixture.settings.adbBootAfter,
            FAKE_ADB_STATE_COUNT: join(fixture.root, 'adb-state-count'),
            FAKE_ADB_BOOT_COUNT: join(fixture.root, 'adb-boot-count'),
            FAKE_AVD_HOME: join(fixture.root, 'avd'),
            FAKE_COMMAND_LOG: fixture.log,
            FAKE_DEVICES: fixture.devices,
            FAKE_EMULATOR: fixture.emulator,
            FAKE_EMULATOR_TEMPLATE: fixture.emulatorTemplate,
            FAKE_IMAGE: fixture.settings.image ? '1' : '0',
            FAKE_INSTALL_EMULATOR: fixture.settings.installEmulator ? '1' : '0',
            FAKE_MANAGER_TRAILING_LINES: fixture.settings.managerTrailingLines,
            FAKE_PAIRS: fixture.pairs,
            FAKE_RUNTIMES: fixture.runtimes,
            PATH: `${fixture.bin}:${process.env.PATH}`,
            WATCH_SIM_BOOT_TIMEOUT_SECONDS: fixture.settings.bootTimeout,
            XCHAIN_ANDROID_SDK: fixture.sdk,
        },
    });
}

function runtimeData(present) {
    if (!present) return { runtimes: [] };
    return {
        runtimes: [
            {
                identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-2',
                isAvailable: true,
                name: 'iOS 27.2',
                version: '27.2',
                supportedDeviceTypes: [
                    { identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' },
                ],
            },
            {
                identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-27-2',
                isAvailable: true,
                name: 'watchOS 27.2',
                version: '27.2',
                supportedDeviceTypes: [
                    { identifier: 'com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-9-41mm' },
                    { identifier: 'com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-4-49mm' },
                ],
            },
        ],
    };
}

function deviceData(present, correctTypes, watchRuntime = 'com.apple.CoreSimulator.SimRuntime.watchOS-27-2') {
    const type = (identifier) => correctTypes
        ? `com.apple.CoreSimulator.SimDeviceType.${identifier}`
        : 'com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M4-8GB';
    return {
        devices: present ? {
            'com.apple.CoreSimulator.SimRuntime.iOS-27-2': [
                {
                    deviceTypeIdentifier: type('iPhone-17'),
                    isAvailable: true,
                    name: 'XC iPhone 17',
                    udid: 'PHONE-17',
                },
            ],
            [watchRuntime]: [
                {
                    deviceTypeIdentifier: type('Apple-Watch-Series-9-41mm'),
                    isAvailable: true,
                    name: 'XC Watch 41mm',
                    udid: 'WATCH-SMALL',
                },
                {
                    deviceTypeIdentifier: type('Apple-Watch-Ultra-4-49mm'),
                    isAvailable: true,
                    name: 'XC Watch 49mm',
                    udid: 'WATCH-LARGE',
                },
            ],
        } : {},
    };
}

function pairData(present) {
    return {
        pairs: present ? {
            'PAIR-SMALL': { phone: { udid: 'PHONE-17' }, watch: { udid: 'WATCH-SMALL' } },
            'PAIR-LARGE': { phone: { udid: 'PHONE-17' }, watch: { udid: 'WATCH-LARGE' } },
        } : {},
    };
}

function xcrunStub() {
    return `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_COMMAND_LOG"
case "$*" in
  'simctl list runtimes -j') cat "$FAKE_RUNTIMES" ;;
  'simctl list devices -j') cat "$FAKE_DEVICES" ;;
  'simctl list pairs -j') cat "$FAKE_PAIRS" ;;
  'simctl create XC iPhone 17 '*) printf 'PHONE-17\n' ;;
  'simctl create XC Watch 41mm '*) printf 'WATCH-SMALL\n' ;;
  'simctl create XC Watch 49mm '*) printf 'WATCH-LARGE\n' ;;
  'simctl pair WATCH-SMALL PHONE-17') printf 'PAIR-SMALL\n' ;;
  'simctl pair WATCH-LARGE PHONE-17') printf 'PAIR-LARGE\n' ;;
esac
`;
}

function commandStub(name) {
    return `#!/usr/bin/env bash\nprintf '${name} %s\\n' "$*" >> "$FAKE_COMMAND_LOG"\n`;
}

function sdkmanagerStub() {
    return `#!/usr/bin/env bash
printf 'sdkmanager %s\n' "$*" >> "$FAKE_COMMAND_LOG"
if [[ "$*" == *'--list_installed'* ]]; then
  [ "$FAKE_IMAGE" = 1 ] && printf '%s\n' 'system-images;android-36;android-wear-signed;arm64-v8a'
  for ((i = 0; i < FAKE_MANAGER_TRAILING_LINES; i++)); do printf 'package-%04d\n' "$i"; done
elif [ "$FAKE_INSTALL_EMULATOR" = 1 ]; then
  mkdir -p "$(dirname "$FAKE_EMULATOR")"
  cp "$FAKE_EMULATOR_TEMPLATE" "$FAKE_EMULATOR"
  chmod +x "$FAKE_EMULATOR"
fi
`;
}

function avdmanagerStub() {
    return `#!/usr/bin/env bash
printf 'avdmanager %s\n' "$*" >> "$FAKE_COMMAND_LOG"
if [ "$*" = 'list avd' ] && [ "$FAKE_AVDS" = 1 ]; then
  printf '%s\n' \
    'Name: xc-wear-small-round' "Path: $FAKE_AVD_HOME/xc-wear-small-round.avd" \
    '---------' \
    'Name: xc-wear-large-round' "Path: $FAKE_AVD_HOME/xc-wear-large-round.avd"
  for ((i = 0; i < FAKE_MANAGER_TRAILING_LINES; i++)); do printf 'avd-%04d\n' "$i"; done
fi
`;
}

function avdConfig(device, correctImage, logicalSize) {
    const imagePath = correctImage
        ? 'system-images/android-36/android-wear-signed/arm64-v8a/'
        : 'system-images/android-35/google_apis/arm64-v8a/';
    const density = 320;
    const pixels = logicalSize * density / 160;
    return [
        `hw.device.name=${device}`,
        `hw.lcd.width=${pixels}`,
        `hw.lcd.height=${pixels}`,
        `hw.lcd.density=${density}`,
        `image.sysdir.1=${imagePath}`,
        '',
    ].join('\n');
}

function emulatorStub() {
    return `#!/usr/bin/env bash
printf 'emulator %s\n' "$*" >> "$FAKE_COMMAND_LOG"
exec sleep 30
`;
}

function adbStub() {
    return `#!/usr/bin/env bash
printf 'adb %s\n' "$*" >> "$FAKE_COMMAND_LOG"
case "$*" in
  *' get-state')
    count=$(($(cat "$FAKE_ADB_STATE_COUNT" 2>/dev/null || printf 0) + 1))
    printf '%s\n' "$count" > "$FAKE_ADB_STATE_COUNT"
    [ "$count" -ge "$FAKE_ADB_STATE_AFTER" ] && printf 'device\n' ;;
  *' shell getprop sys.boot_completed')
    count=$(($(cat "$FAKE_ADB_BOOT_COUNT" 2>/dev/null || printf 0) + 1))
    printf '%s\n' "$count" > "$FAKE_ADB_BOOT_COUNT"
    [ "$count" -ge "$FAKE_ADB_BOOT_AFTER" ] && printf '1\n' ;;
esac
`;
}

function put(path, contents, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    if (mode) chmodSync(path, mode);
}
