// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const source = readFileSync(resolve('packages/mobile/scripts/watch-test.sh'), 'utf8');
const fixtures = [];
afterEach(() => fixtures.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('watch-test.sh', () => {
    it.each([
        ['watch41', 'WatchApp', 'WatchAppTests/BalanceTests', 'XC Watch 41mm'],
        ['watch49', 'WatchApp', 'WatchAppTests/BalanceTests', 'XC Watch 49mm'],
        ['phone', 'App', 'AppTests/VaultTests', 'XC iPhone 17'],
    ])('runs %s and proves execution from xcresult data', (target, scheme, only, device) => {
        const fixture = makeFixture();
        const result = run(fixture, [target, target === 'phone' ? 'VaultTests' : 'BalanceTests']);
        const commands = readFileSync(fixture.log, 'utf8');
        expect(result.status).toBe(0);
        expect(commands).toContain(`-scheme ${scheme}`);
        expect(commands).toContain(`-only-testing:${only}`);
        expect(commands).toContain(`name=${device}`);
        expect(commands).toContain('xcresulttool get test-results summary');
    });

    it('rejects found-count output when the result bundle says zero ran', () => {
        const fixture = makeFixture();
        const result = run(fixture, ['watch41', 'BalanceTests'], { FAKE_XCODE_COUNTS: 'zero' });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('1 test found');
        expect(result.stderr).toContain('zero executed tests');
    });

    it('fails loudly when a simulator is missing', () => {
        const fixture = makeFixture();
        const result = run(fixture, ['phone', 'VaultTests'], { FAKE_NO_SIMS: '1' });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("no available simulator named 'XC iPhone 17'");
        expect(readFileSync(fixture.log, 'utf8')).not.toContain('xcodebuild');
    });

    it.each(['wear', 'app'])('runs %s unit tests and proves execution from JUnit XML', (target) => {
        const fixture = makeFixture();
        const result = run(fixture, [target, 'BalanceTests']);
        expect(result.status).toBe(0);
        expect(readFileSync(fixture.log, 'utf8')).toContain(
            `:${target}:testDebugUnitTest`,
        );
        expect(readFileSync(fixture.log, 'utf8')).toContain('--tests *.BalanceTests');
    });

    it('rejects Gradle found-count output when JUnit XML says zero ran', () => {
        const fixture = makeFixture();
        const result = run(fixture, ['app', 'BalanceTests'], { FAKE_GRADLE_COUNT: '0' });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('1 test found');
        expect(result.stderr).toContain('zero executed tests');
    });

    it('runs arbitrary Gradle tasks without demanding test results', () => {
        const fixture = makeFixture();
        const result = run(fixture, ['gradle', 'help']);
        expect(result.status).toBe(0);
        expect(readFileSync(fixture.log, 'utf8')).toContain(
            `gradlew JAVA=fixture-java ANDROID=fixture-android HOME=${fixture.root}/tmp/watch-test/gradle-home --no-daemon -p packages/mobile/android help`,
        );
    });

    it('syncs missing Android build inputs before Gradle', () => {
        const fixture = makeFixture();
        rmSync(join(fixture.root, 'packages/mobile/android/version.properties'));
        const result = run(fixture, ['gradle', 'help']);
        const commands = readFileSync(fixture.log, 'utf8');
        expect(result.status).toBe(0);
        expect(commands).toContain('pnpm --filter @xchain-wallet/web build');
        expect(commands).toContain('pnpm --filter @xchain-wallet/mobile sync');
        expect(commands.indexOf('pnpm')).toBeLessThan(commands.indexOf('gradlew'));
    });
});

function makeFixture() {
    const root = mkdtempSync(join(tmpdir(), 'xchain-watch-test-'));
    fixtures.push(root);
    const script = join(root, 'packages/mobile/scripts/watch-test.sh');
    const bin = join(root, 'bin');
    const log = join(root, 'commands.log');
    put(script, source, 0o755);
    put(join(root, 'package.json'), '{"version":"1.2.3"}\n');
    put(join(root, 'packages/mobile/ios/App/Version.xcconfig'), 'VERSION=1\n');
    put(join(root, 'packages/mobile/ios/App/App/public/index.html'), 'ok\n');
    for (const stamp of [
        'packages/mobile/android/version.properties',
        'packages/mobile/www/webdir-stamp.txt',
        'packages/mobile/android/app/src/main/assets/public/webdir-stamp.txt',
    ]) put(join(root, stamp), 'ok\n');
    put(log, '');
    put(join(bin, 'xcrun'), `#!/usr/bin/env bash
printf 'xcrun %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
if [ "$1 $2 $3 $4" = 'simctl list devices available' ]; then
  [ "\${FAKE_NO_SIMS:-}" = 1 ] || printf '%s\\n' 'XC Watch 41mm (AAAA) (Shutdown)' 'XC Watch 49mm (BBBB) (Shutdown)' 'XC iPhone 17 (CCCC) (Shutdown)'
elif [ "$1 $2 $3 $4" = 'xcresulttool get test-results summary' ]; then
  [ "\${FAKE_XCODE_COUNTS:-}" = zero ] && printf '%s\\n' '{"passedTests":0,"failedTests":0}' || printf '%s\\n' '{"passedTests":1,"failedTests":0}'
fi
`, 0o755);
    put(join(bin, 'xcodebuild'), `#!/usr/bin/env bash
printf 'xcodebuild %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
printf '%s\\n' '1 test found'
`, 0o755);
    put(join(bin, 'pnpm'), '#!/usr/bin/env bash\nprintf "pnpm %s\\n" "$*" >> "$FAKE_COMMAND_LOG"\n', 0o755);
    put(join(root, 'packages/mobile/android/gradlew'), `#!/usr/bin/env bash
printf 'gradlew JAVA=%s ANDROID=%s HOME=%s %s\\n' "$JAVA_HOME" "$ANDROID_HOME" "$GRADLE_USER_HOME" "$*" >> "$FAKE_COMMAND_LOG"
printf '%s\\n' '1 test found'
for module in wear app; do
  if [[ "$*" == *":$module:testDebugUnitTest"* ]]; then
    out="$PWD/packages/mobile/android/$module/build/test-results/testDebugUnitTest/TEST-result.xml"
    mkdir -p "$(dirname "$out")"
    printf '<testsuite tests="%s"/>\\n' "\${FAKE_GRADLE_COUNT:-1}" > "$out"
  fi
done
`, 0o755);
    return { root, script, bin, log };
}

function run(fixture, args, overrides = {}) {
    return spawnSync('/bin/bash', [fixture.script, ...args], {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
            ...process.env,
            ANDROID_HOME: 'ignored',
            JAVA_HOME: 'fixture-java',
            XCHAIN_ANDROID_SDK: 'fixture-android',
            FAKE_COMMAND_LOG: fixture.log,
            PATH: `${fixture.bin}:${process.env.PATH}`,
            ...overrides,
        },
    });
}

function put(path, contents, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    if (mode) chmodSync(path, mode);
}
