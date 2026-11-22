// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const acceptanceSource = readFileSync(join(root, 'packages/mobile/scripts/watch-acceptance.sh'), 'utf8');
const pendingSource = readFileSync(join(root, 'tools/watch/pending-watch-keys.mjs'), 'utf8');
const invokedDirectlySource = readFileSync(join(root, 'tools/release/is-invoked-directly.mjs'), 'utf8');
const fixtureRoot = join(root, 'tmp');
const fixtures = [];

afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe('watch-acceptance.sh', () => {
    it('runs every acceptance command with the required modes and suites', () => {
        const fixture = makeFixture('const pendingWatchKeys = {};\n');
        const result = run(fixture);
        const pending = join(fixture.root, 'tmp/pending-watch-keys.js');

        expect(result.status).toBe(0);
        expect(lines(fixture.log)).toEqual([
            'pnpm XCHAIN_NATIVE_SMOKES= test:unit',
            'pnpm XCHAIN_NATIVE_SMOKES=1 test:smoke',
            'pnpm XCHAIN_NATIVE_SMOKES= test:tools',
            'node tools/watch/gen-strings.mjs --check',
            `node tools/watch/pending-watch-keys.mjs ${pending}`,
            'xcodebuild test -project packages/mobile/ios/App/App.xcodeproj -scheme WatchApp -destination platform=watchOS Simulator,name=XC Watch 41mm -only-testing:WatchAppTests',
            'xcodebuild test -project packages/mobile/ios/App/App.xcodeproj -scheme WatchApp -destination platform=watchOS Simulator,name=XC Watch 49mm -only-testing:WatchAppTests',
            'xcodebuild test -project packages/mobile/ios/App/App.xcodeproj -scheme App -destination platform=iOS Simulator,name=XC iPhone 17 -only-testing:AppTests',
            'watch-test gradle :wear:testDebugUnitTest :app:testDebugUnitTest',
            'npx playwright test --config test/e2e/playwright.config.js test/e2e/tests/layout/shell-widths.spec.js test/e2e/tests/layout/fold-transition.spec.js',
            'ios-archive XCHAIN_IOS_ARCHIVE_UNSIGNED=1',
            'node tools/release/verify-ios-artifact.mjs packages/mobile/ios/build/App.xcarchive/Products/Applications/App.app --stage archive --unsigned',
        ]);
    });

    it('fails on pending watch keys before any native suite runs', () => {
        const fixture = makeFixture("const pendingWatchKeys = { 'watch.title': 'row A' };\n");
        const result = run(fixture);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('watch.title row A');
        expect(lines(fixture.log).some((line) => line.startsWith('xcodebuild '))).toBe(false);
        expect(lines(fixture.log).some((line) => line.startsWith('watch-test '))).toBe(false);
        expect(lines(fixture.log).some((line) => line.startsWith('ios-archive '))).toBe(false);
    });
});

function makeFixture(pendingKeys) {
    mkdirSync(fixtureRoot, { recursive: true });
    const fixture = mkdtempSync(join(fixtureRoot, 'watch-acceptance-'));
    fixtures.push(fixture);
    const bin = join(fixture, 'bin');
    const log = join(fixture, 'tmp/commands.log');
    const pending = join(fixture, 'tmp/pending-watch-keys.js');

    put(join(fixture, 'packages/mobile/scripts/watch-acceptance.sh'), acceptanceSource, 0o755);
    put(join(fixture, 'tools/watch/pending-watch-keys.mjs'), pendingSource);
    put(join(fixture, 'tools/release/is-invoked-directly.mjs'), invokedDirectlySource);
    put(pending, pendingKeys);
    put(log, '');
    put(join(bin, 'pnpm'), '#!/usr/bin/env bash\nprintf "pnpm XCHAIN_NATIVE_SMOKES=%s %s\\n" "${XCHAIN_NATIVE_SMOKES:-}" "$*" >> "$COMMAND_LOG"\n', 0o755);
    put(join(bin, 'npx'), '#!/usr/bin/env bash\nprintf "npx %s\\n" "$*" >> "$COMMAND_LOG"\n', 0o755);
    put(join(bin, 'xcodebuild'), '#!/usr/bin/env bash\nprintf "xcodebuild %s\\n" "$*" >> "$COMMAND_LOG"\n', 0o755);
    put(join(bin, 'node'), `#!/usr/bin/env bash
printf 'node %s\\n' "$*" >> "$COMMAND_LOG"
if [ "$1" = tools/watch/pending-watch-keys.mjs ]; then
  exec "${process.execPath}" "$@"
fi
`, 0o755);
    put(join(fixture, 'packages/mobile/scripts/watch-test.sh'), '#!/usr/bin/env bash\nprintf "watch-test %s\\n" "$*" >> "$COMMAND_LOG"\n', 0o755);
    put(join(fixture, 'tools/release/ios-archive.sh'), '#!/usr/bin/env bash\nprintf "ios-archive XCHAIN_IOS_ARCHIVE_UNSIGNED=%s\\n" "${XCHAIN_IOS_ARCHIVE_UNSIGNED:-}" >> "$COMMAND_LOG"\n', 0o755);
    return { root: fixture, script: join(fixture, 'packages/mobile/scripts/watch-acceptance.sh'), bin, log, pending };
}

function run(fixture) {
    return spawnSync('/bin/bash', [fixture.script], {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
            ...process.env,
            COMMAND_LOG: fixture.log,
            PATH: `${fixture.bin}:${process.env.PATH}`,
            XCHAIN_NATIVE_SMOKES: '',
            XCHAIN_PENDING_WATCH_KEYS_SOURCE: fixture.pending,
        },
    });
}

function lines(path) {
    return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
}

function put(path, contents, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    if (mode) chmodSync(path, mode);
}
