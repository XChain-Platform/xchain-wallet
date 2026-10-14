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

const SOURCE = resolve(process.cwd(), 'packages/mobile/scripts/ios-console.sh');
const source = readFileSync(SOURCE, 'utf8');
const fixtures = [];

afterEach(() => {
    for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe('ios-console.sh', () => {
    it('streams unbuffered output for a staged simulator build', () => {
        const fixture = makeFixture({ profile: 'store' });
        const capture = join(fixture.root, 'captured.log');
        // The stub prints its line and exits, and the script returns as soon
        // as the console ends, so this waits for the line rather than racing
        // a short window. DURATION is only the ceiling for a stub that hangs.
        const result = run(fixture, ['iPhone 17 Pro'], {
            DURATION: '30',
            LOG: capture,
            SKIP_BUILD: '1',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("staged web bundle profile is 'store'");
        expect(result.stdout).toContain('native console output');
        expect(readFileSync(capture, 'utf8')).toContain('native console output');
        expect(readFileSync(fixture.log, 'utf8')).toContain(
            'NS=YES simctl launch --console --terminate-running-process',
        );
    });

    it('builds and installs when SKIP_BUILD is not set', () => {
        const fixture = makeFixture({ profile: null });
        const result = run(fixture, ['iPhone 17 Pro']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('building Debug for the simulator');
        expect(result.stderr).toContain('no staged web bundle');
        const commands = readFileSync(fixture.log, 'utf8');
        expect(commands).toContain('-configuration Debug');
        expect(commands).toContain('simctl install 11111111-1111-1111-1111-111111111111');
    });

    it('stops before launch when the simulator is unknown', () => {
        const fixture = makeFixture({ profile: 'default' });
        const result = run(fixture, ['iPhone Missing']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("no available simulator named 'iPhone Missing'");
        expect(readFileSync(fixture.log, 'utf8')).not.toContain('simctl launch');
    });
});

function makeFixture({ profile }) {
    const root = mkdtempSync(join(tmpdir(), 'xchain-ios-console-'));
    fixtures.push(root);
    const script = join(root, 'packages/mobile/scripts/ios-console.sh');
    const project = join(root, 'packages/mobile/ios/App/App.xcodeproj');
    const bin = join(root, 'bin');
    const log = join(root, 'commands.log');

    put(script, source, 0o755);
    mkdirSync(project, { recursive: true });
    if (profile !== null) put(join(root, 'packages/mobile/www/build-profile.txt'), `${profile}\n`);
    put(log, '');
    put(join(bin, 'xcrun'), [
        '#!/usr/bin/env bash',
        'printf "NS=%s %s\\n" "${SIMCTL_CHILD_NSUnbufferedIO:-}" "$*" >> "$FAKE_COMMAND_LOG"',
        'if [ "$*" = "simctl list devices available" ]; then',
        '  printf "%s\\n" "iPhone 17 Pro (11111111-1111-1111-1111-111111111111) (Shutdown)"',
        'elif [[ "$*" == *"simctl launch"* ]]; then',
        '  printf "%s\\n" "native console output"',
        'fi',
    ].join('\n'), 0o755);
    put(join(bin, 'xcodebuild'), [
        '#!/usr/bin/env bash',
        'printf "%s\\n" "$*" >> "$FAKE_COMMAND_LOG"',
    ].join('\n'), 0o755);

    return { root, script, bin, log };
}

function run(fixture, args, overrides = {}) {
    const env = {
        ...process.env,
        FAKE_COMMAND_LOG: fixture.log,
        PATH: `${fixture.bin}:${process.env.PATH}`,
        ...overrides,
    };
    if (!Object.hasOwn(overrides, 'SKIP_BUILD')) delete env.SKIP_BUILD;
    if (!Object.hasOwn(overrides, 'DURATION')) delete env.DURATION;
    if (!Object.hasOwn(overrides, 'LOG')) delete env.LOG;
    return spawnSync('/bin/bash', [fixture.script, ...args], {
        cwd: fixture.root,
        encoding: 'utf8',
        env,
    });
}

function put(path, contents, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    if (mode) chmodSync(path, mode);
}
