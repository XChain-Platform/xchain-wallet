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
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const SOURCE = resolve(process.cwd(), 'packages/mobile/scripts/screenshots.sh');
const source = readFileSync(SOURCE, 'utf8');
const fixtures = [];

afterEach(() => {
    for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe('screenshots.sh', () => {
    it('captures a named simulator from a store-profile fixture', () => {
        const fixture = makeFixture({ profile: 'store' });
        const result = run(fixture, ['iPhone 17 Pro']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("staged bundle profile is 'store'");
        expect(result.stdout).toContain('=== iPhone 17 Pro ===');
        expect(result.stdout).toContain('pinning the set to abc1234');
        expect(readFileSync(fixture.log, 'utf8')).toContain(
            'simctl uninstall 11111111-1111-1111-1111-111111111111 io.xchain.wallet.ios',
        );
        expect(readFileSync(fixture.log, 'utf8')).toContain(
            '-destination id=11111111-1111-1111-1111-111111111111',
        );
    });

    it('refuses a staged bundle whose profile is not store', () => {
        const fixture = makeFixture({ profile: 'default' });
        const result = run(fixture);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("profile 'default', refusing to shoot a listing set");
        expect(readFileSync(fixture.log, 'utf8')).toBe('');
    });

    it('reports available devices when the simulator is absent', () => {
        const fixture = makeFixture({ profile: 'store' });
        const result = run(fixture, ['iPhone Missing']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("no available simulator named 'iPhone Missing'");
        expect(result.stderr).toContain('iPhone 17 Pro');
        expect(result.stderr).toContain('iPad Pro 13-inch');
    });
});

function makeFixture({ profile }) {
    const root = mkdtempSync(join(tmpdir(), 'xchain-screenshots-'));
    fixtures.push(root);
    const script = join(root, 'packages/mobile/scripts/screenshots.sh');
    const project = join(root, 'packages/mobile/ios/App/App.xcodeproj');
    const stamp = join(root, 'packages/mobile/www/build-profile.txt');
    const bin = join(root, 'bin');
    const log = join(root, 'commands.log');

    put(script, source, 0o755);
    mkdirSync(project, { recursive: true });
    put(stamp, `${profile}\n`);
    put(log, '');
    put(join(root, 'tools/release/verify-listing-assets.mjs'), 'process.exit(0);\n');
    put(join(bin, 'xcrun'), [
        '#!/usr/bin/env bash',
        'printf "NS=%s %s\\n" "${SIMCTL_CHILD_NSUnbufferedIO:-}" "$*" >> "$FAKE_COMMAND_LOG"',
        'if [ "$*" = "simctl list devices available" ]; then',
        '  printf "%s\\n" "iPhone 17 Pro (11111111-1111-1111-1111-111111111111) (Shutdown)"',
        '  printf "%s\\n" "iPad Pro 13-inch (M5) (22222222-2222-2222-2222-222222222222) (Shutdown)"',
        'fi',
    ].join('\n'), 0o755);
    put(join(bin, 'xcodebuild'), [
        '#!/usr/bin/env bash',
        'printf "%s\\n" "$*" >> "$FAKE_COMMAND_LOG"',
    ].join('\n'), 0o755);
    put(join(bin, 'git'), [
        '#!/usr/bin/env bash',
        'printf "%s\\n" "$*" >> "$FAKE_COMMAND_LOG"',
        'printf "%s\\n" "abc1234"',
    ].join('\n'), 0o755);

    return { root, script, bin, log };
}

function run(fixture, args = []) {
    return spawnSync('/bin/bash', [fixture.script, ...args], {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
            ...process.env,
            FAKE_COMMAND_LOG: fixture.log,
            KEEP_STORE_BUNDLE: '1',
            PATH: `${fixture.bin}:${process.env.PATH}`,
            SKIP_BUILD: '1',
        },
    });
}

function put(path, contents, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    if (mode) chmodSync(path, mode);
}
