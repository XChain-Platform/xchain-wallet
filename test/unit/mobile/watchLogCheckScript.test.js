// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const scriptSource = readFileSync(resolve('packages/mobile/scripts/watch-log-check.sh'), 'utf8');
const simLogSource = readFileSync(resolve('packages/mobile/scripts/sim-log.js'), 'utf8');
const watchEventLogSource = readFileSync(
    resolve('packages/mobile/ios/App/WatchApp/Link/WatchEventLog.swift'),
    'utf8',
);
const fixtures = [];

afterEach(() => fixtures.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('watch-log-check.sh', () => {
    it('finds both watch lines in one bounded log show call', () => {
        const fixture = makeFixture(logEntries());
        const result = run(fixture, ['--udid', 'WATCH-UDID', '--since', '2026-11-24 10:00:00']);
        const calls = readFileSync(fixture.calls, 'utf8').trim().split('\n');

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('watch log: snapshot v1 and W1 seen\n');
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('simctl spawn WATCH-UDID log show');
        expect(calls[0]).toContain('--style ndjson');
        expect(calls[0]).toContain('--start 2026-11-24 10:00:00');
        expect(calls[0]).toContain('--predicate subsystem == "io.xchain.wallet.ios.watch"');
    });

    it('names the missing screen line when only the snapshot was logged', () => {
        const fixture = makeFixture(logEntries({ screen: false }));
        const result = run(fixture, requiredArgs);

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('Log entry not found: screen shown W1\n');
    });

    it('names both missing lines when neither was logged', () => {
        const fixture = makeFixture('');
        const result = run(fixture, requiredArgs);

        expect(result.status).toBe(1);
        expect(result.stdout).toBe(
            'Log entry not found: snapshot received v1\nLog entry not found: screen shown W1\n',
        );
    });

    it.each([
        ['another subsystem', logEntries({ subsystem: 'io.xchain.wallet.other' })],
        ['another category', logEntries({ category: 'other' })],
    ])('rejects both lines under %s', (_description, log) => {
        const fixture = makeFixture(log);
        const result = run(fixture, requiredArgs);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('Log entry not found: snapshot received v1');
        expect(result.stdout).toContain('Log entry not found: screen shown W1');
    });

    it('names log show when log collection fails', () => {
        const fixture = makeFixture(logEntries());
        const result = run(fixture, requiredArgs, { FAKE_XCRUN_FAIL: '1' });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('log show');
    });

    it.each([
        ['a missing --udid', ['--since', '2026-11-24 10:00:00']],
        ['a missing --since', ['--udid', 'WATCH-UDID']],
        ['an unknown flag', ['--udid', 'WATCH-UDID', '--since', 'start', '--other', 'value']],
        ['a flag without a value', ['--udid', 'WATCH-UDID', '--since']],
    ])('exits 2 with usage for %s', (_description, args) => {
        const fixture = makeFixture(logEntries());
        const result = run(fixture, args);

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('usage: packages/mobile/scripts/watch-log-check.sh');
    });

    it('keeps its filters aligned with the watch event writer', () => {
        expect(watchEventLogSource).toContain('static let subsystem = "io.xchain.wallet.ios.watch"');
        expect(watchEventLogSource).toContain('static let category = "link"');
        expect(watchEventLogSource).toContain('snapshot received v');
        expect(watchEventLogSource).toContain('screenID = "W1"');
        expect(scriptSource).toContain('io.xchain.wallet.ios.watch');
        expect(scriptSource).toContain('--category link');
        expect(scriptSource).toContain("--contains 'snapshot received v1'");
        expect(scriptSource).toContain("--contains 'screen shown W1'");
    });
});

const requiredArgs = ['--udid', 'WATCH-UDID', '--since', '2026-11-24 10:00:00'];

function makeFixture(log) {
    const root = mkdtempSync(join(tmpdir(), 'xchain-watch-log-check-'));
    fixtures.push(root);
    const script = join(root, 'packages/mobile/scripts/watch-log-check.sh');
    const bin = join(root, 'bin');
    const calls = join(root, 'xcrun.log');
    const cannedLog = join(root, 'canned.ndjson');

    put(script, scriptSource, 0o755);
    put(join(root, 'packages/mobile/scripts/sim-log.js'), simLogSource);
    put(join(root, 'package.json'), '{"type":"module"}\n');
    put(calls, '');
    put(cannedLog, log);
    put(join(bin, 'xcrun'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_XCRUN_CALLS"
[ "\${FAKE_XCRUN_FAIL:-}" = 1 ] && exit 1
cat "$FAKE_SIM_LOG"
`, 0o755);

    return { root, script, bin, calls, cannedLog };
}

function run(fixture, args, overrides = {}) {
    return spawnSync('/bin/bash', [fixture.script, ...args], {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
            ...process.env,
            FAKE_SIM_LOG: fixture.cannedLog,
            FAKE_XCRUN_CALLS: fixture.calls,
            PATH: `${fixture.bin}:${process.env.PATH}`,
            ...overrides,
        },
    });
}

function logEntries({
    subsystem = 'io.xchain.wallet.ios.watch',
    category = 'link',
    screen = true,
} = {}) {
    const messages = ['snapshot received v1'];
    if (screen) messages.push('screen shown W1');
    return `${messages.map((message, index) => JSON.stringify({
        eventType: 'logEvent',
        eventMessage: message,
        subsystem,
        category,
        processImagePath: '/Applications/XChain Watch.app/XChain Watch',
        processID: 417,
        timestamp: `2026-11-24 10:00:0${index}.100-0800`,
    })).join('\n')}\n`;
}

function put(path, contents, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    if (mode) chmodSync(path, mode);
}
