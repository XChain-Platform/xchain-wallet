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
        expect(commands).toContain('watch-test.sh gradle :app:assembleDebug :app:assembleDebugAndroidTest :wear:assembleDebug');
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

    it('discovers the phone and watch', () => {
        const fixture = makeFixture();
        const result = run(fixture, 'balances', { WEAR_PHONE_SERIAL: '', WEAR_WATCH_SERIAL: '' });
        const commands = readFileSync(fixture.log, 'utf8');

        expect(result.status, result.stderr).toBe(0);
        expect(commands).toContain('adb devices -l');
        expect(commands).toContain('adb -s PHONE shell getprop ro.build.characteristics');
        expect(commands).toContain('adb -s WATCH shell getprop ro.build.characteristics');
    });

    it.each(['Balances', 'Token 01 $1.00', 'Token 50 $50.00'])(
        'exits 1 when the copied W1 expectation %s is missing',
        (missingLine) => {
            const fixture = makeFixture();
            const result = run(fixture, 'balances', {
                FAKE_MISSING_LINE: missingLine,
                WEAR_ACCEPTANCE_TIMEOUT_SECONDS: '0',
            });

            expect(result.status).toBe(1);
            expect(result.stderr).toContain(`wear-acceptance: missing ${missingLine}`);
        },
    );

    it('requires the detail-native W2 price line node', () => {
        const fixture = makeFixture();
        const result = run(fixture, 'balances', {
            FAKE_MISSING_W2_NODE: '1',
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('wear-acceptance: missing detail-native W2 price line node');
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
    // The script builds through watch-test.sh, which stages web assets before Gradle; the stub only logs the call.
    put(join(root, 'packages/mobile/scripts/watch-test.sh'), '#!/usr/bin/env bash\nprintf "watch-test.sh %s\\n" "$*" >> "$FAKE_COMMAND_LOG"\n', 0o755);
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
    header='Balances'
    first='Token 01 $1.00'
    last='Token 50 $50.00'
    [ "\${FAKE_MISSING_LINE:-}" = "$header" ] && header=''
    [ "\${FAKE_MISSING_LINE:-}" = "$first" ] && first=''
    [ "\${FAKE_MISSING_LINE:-}" = "$last" ] && last=''
    price_line='7-day price line'
    [ -n "\${FAKE_MISSING_W2_NODE:-}" ] && price_line=''
    printf '<hierarchy><node text="%s"/><node text="%s"/><node text="%s"/><node text="detail-native price line context"/><node content-desc="%s"/><node text="xch1acceptanceaddress123 complication text 1 alert Tile text 1 alert •••• Show wallet on watch is off on your phone Watch acceptance alert"/></hierarchy>\\n' "$header" "$first" "$last" "$price_line"
elif [ "$3 $4 $5" = 'shell dumpsys notification' ]; then
    printf '%s\\n' 'NotificationRecord(1: pkg=io.xchain.wallet.android.debug user=u: Notification(channel=alert))'
    printf '%s\\n' '  extras={' '    android.title=String (Watch acceptance alert)' '  }'
    printf '%s\\n' 'NotificationRecord(2: pkg=io.xchain.wallet.android.debug user=u: Notification(channel=payment))'
    printf '%s\\n' '  extras={' '    android.title=String (Payment due)' '  }' '  actions={' '    [0] "Open on phone" -> PendingIntent{1}' '  }'
fi
`;
