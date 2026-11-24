// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const scriptSource = readFileSync(resolve('packages/mobile/scripts/watch-pair-install.sh'), 'utf8');
const projectSource = readFileSync(
    resolve('packages/mobile/ios/App/App.xcodeproj/project.pbxproj'),
    'utf8',
);
const fixtures = [];

afterEach(() => fixtures.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('watch-pair-install.sh', () => {
    it('installs the phone and embedded watch apps and confirms both bundle ids', () => {
        const fixture = makeFixture();
        const result = run(fixture, requiredArgs(fixture));

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(
            'watch pair install: io.xchain.wallet.ios and io.xchain.wallet.ios.watch installed\n',
        );
        expect(calls(fixture)).toEqual([
            `simctl install PHONE-UDID ${fixture.app}`,
            `simctl install WATCH-UDID ${fixture.watchApp}`,
            'simctl get_app_container PHONE-UDID io.xchain.wallet.ios',
            'simctl get_app_container WATCH-UDID io.xchain.wallet.ios.watch',
        ]);
    });

    it.each([
        ['no Watch directory', { createWatch: false }],
        ['an empty Watch directory', { watchApps: [] }],
        ['two embedded watch apps', { watchApps: ['First.app', 'Second.app'] }],
    ])('rejects an App.app with %s before calling xcrun', (_description, options) => {
        const fixture = makeFixture(options);
        const result = run(fixture, requiredArgs(fixture));

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`${fixture.app}/Watch`);
        expect(calls(fixture)).toEqual([]);
    });

    it('rejects an app path that is not a directory before calling xcrun', () => {
        const fixture = makeFixture({ createApp: false });
        const result = run(fixture, requiredArgs(fixture));

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(fixture.app);
        expect(calls(fixture)).toEqual([]);
    });

    it('stops after a failed phone install', () => {
        const fixture = makeFixture();
        const result = run(fixture, requiredArgs(fixture), {
            FAKE_XCRUN_FAIL: 'install:PHONE-UDID',
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('phone install');
        expect(calls(fixture)).toEqual([`simctl install PHONE-UDID ${fixture.app}`]);
    });

    it('stops after a failed watch install', () => {
        const fixture = makeFixture();
        const result = run(fixture, requiredArgs(fixture), {
            FAKE_XCRUN_FAIL: 'install:WATCH-UDID',
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('watch install');
        expect(calls(fixture)).toEqual([
            `simctl install PHONE-UDID ${fixture.app}`,
            `simctl install WATCH-UDID ${fixture.watchApp}`,
        ]);
    });

    it('names the missing watch bundle after checking both installs', () => {
        const fixture = makeFixture();
        const result = run(fixture, requiredArgs(fixture), {
            FAKE_XCRUN_FAIL: 'get_app_container:WATCH-UDID',
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('io.xchain.wallet.ios.watch');
        expect(calls(fixture)).toHaveLength(4);
    });

    it('still checks the watch bundle when the phone bundle is missing', () => {
        const fixture = makeFixture();
        const result = run(fixture, requiredArgs(fixture), {
            FAKE_XCRUN_FAIL: 'get_app_container:PHONE-UDID',
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('io.xchain.wallet.ios is not installed');
        expect(calls(fixture).at(-1)).toBe(
            'simctl get_app_container WATCH-UDID io.xchain.wallet.ios.watch',
        );
    });

    it.each([
        ['a missing --phone', (fixture) => ['--watch', 'WATCH-UDID', '--app', fixture.app]],
        ['a missing --watch', (fixture) => ['--phone', 'PHONE-UDID', '--app', fixture.app]],
        ['a missing --app', () => ['--phone', 'PHONE-UDID', '--watch', 'WATCH-UDID']],
        [
            'an unknown flag',
            (fixture) => [...requiredArgs(fixture), '--other', 'value'],
        ],
        [
            '--app without a value',
            () => ['--phone', 'PHONE-UDID', '--watch', 'WATCH-UDID', '--app'],
        ],
    ])('exits 2 with usage for %s', (_description, argsForFixture) => {
        const fixture = makeFixture();
        const result = run(fixture, argsForFixture(fixture));

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('usage: packages/mobile/scripts/watch-pair-install.sh');
        expect(calls(fixture)).toEqual([]);
    });

    it('keeps its bundle ids aligned with the phone and watch targets', () => {
        expect(projectSource).toContain('PRODUCT_BUNDLE_IDENTIFIER = io.xchain.wallet.ios;');
        expect(projectSource).toContain('PRODUCT_BUNDLE_IDENTIFIER = io.xchain.wallet.ios.watch;');
        expect(scriptSource).toContain('io.xchain.wallet.ios');
        expect(scriptSource).toContain('io.xchain.wallet.ios.watch');
    });
});

function requiredArgs(fixture) {
    return ['--phone', 'PHONE-UDID', '--watch', 'WATCH-UDID', '--app', fixture.app];
}

function makeFixture({ createApp = true, createWatch = true, watchApps = ['WatchApp.app'] } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'xchain-watch-pair-install-'));
    fixtures.push(root);
    const script = join(root, 'packages/mobile/scripts/watch-pair-install.sh');
    const bin = join(root, 'bin');
    const callsFile = join(root, 'xcrun.log');
    const app = join(root, 'Build/App.app');
    const watchApp = join(app, 'Watch', watchApps[0] ?? 'WatchApp.app');

    put(script, scriptSource, 0o755);
    put(callsFile, '');
    put(join(bin, 'xcrun'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_XCRUN_CALLS"
[ "\${FAKE_XCRUN_FAIL:-}" = "$2:$3" ] && exit 1
exit 0
`, 0o755);
    if (createApp) mkdirSync(app, { recursive: true });
    if (createApp && createWatch) {
        mkdirSync(join(app, 'Watch'), { recursive: true });
        watchApps.forEach((name) => mkdirSync(join(app, 'Watch', name), { recursive: true }));
    }

    return { root, script, bin, callsFile, app, watchApp };
}

function run(fixture, args, overrides = {}) {
    return spawnSync('/bin/bash', [fixture.script, ...args], {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
            ...process.env,
            FAKE_XCRUN_CALLS: fixture.callsFile,
            PATH: `${fixture.bin}:${process.env.PATH}`,
            ...overrides,
        },
    });
}

function calls(fixture) {
    const contents = readFileSync(fixture.callsFile, 'utf8').trim();
    return contents ? contents.split('\n') : [];
}

function put(path, contents, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    if (mode) chmodSync(path, mode);
}
