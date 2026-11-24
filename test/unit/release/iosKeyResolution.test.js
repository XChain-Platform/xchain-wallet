// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const workspaces = [];

function fixture(keys = ['DISCOVERED42']) {
    const root = mkdtempSync(join(tmpdir(), 'ios-key-resolution-'));
    workspaces.push(root);
    mkdirSync(join(root, 'tools/release'), { recursive: true });
    mkdirSync(join(root, 'packages/mobile/ios/App/App.xcodeproj'), { recursive: true });
    mkdirSync(join(root, 'packages/mobile/ios/build/App.xcarchive/Products/Applications/App.app'), { recursive: true });
    mkdirSync(join(root, 'keys'));
    mkdirSync(join(root, 'release'));
    mkdirSync(join(root, 'bin'));
    for (const script of ['ios-archive.sh', 'ios-export.sh']) {
        cpSync(join(repo, 'tools/release', script), join(root, 'tools/release', script));
    }
    writeFileSync(join(root, 'packages/mobile/ios/App/Version.xcconfig'), 'MARKETING_VERSION = 1.2.3\n');
    writeFileSync(join(root, 'packages/mobile/ios/App/App.xcodeproj/project.pbxproj'), 'DEVELOPMENT_TEAM = TEAM123;\n');
    writeFileSync(join(root, 'release/asc-issuer.txt'), 'issuer-from-file\n');
    for (const id of keys) writeFileSync(join(root, 'keys', `AuthKey_${id}.p8`), 'private-key');
    writeFileSync(join(root, 'bin/node'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(root, 'bin/xcodebuild'), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(join(root, 'xcodebuild.args'))}\nexit 73\n`);
    writeFileSync(join(root, 'bash-env'), 'xcodebuild() { "$IOS_TEST_XCODEBUILD" "$@"; }\n');
    chmodSync(join(root, 'bin/node'), 0o755);
    chmodSync(join(root, 'bin/xcodebuild'), 0o755);
    return root;
}

function run(root, script, extraEnv = {}) {
    return spawnSync('bash', [join(root, 'tools/release', script)], {
        encoding: 'utf8',
        env: {
            HOME: join(root, 'home'),
            PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
            APPLE_API_KEY_DIR: join(root, 'keys'),
            XCHAIN_RELEASE_DIR: join(root, 'release'),
            XCHAIN_RELEASE_TAG: 'v1.2.3',
            BASH_ENV: join(root, 'bash-env'),
            IOS_TEST_XCODEBUILD: join(root, 'bin/xcodebuild'),
            ...extraEnv,
        },
    });
}

afterEach(() => {
    for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('iOS App Store Connect key resolution', () => {
    it.each(['ios-archive.sh', 'ios-export.sh'])('%s discovers the only key and project team', (script) => {
        const root = fixture();
        const result = run(root, script);
        const args = readFileSync(join(root, 'xcodebuild.args'), 'utf8');

        expect(result.status).toBe(73);
        expect(args).toContain(`-authenticationKeyPath\n${join(root, 'keys/AuthKey_DISCOVERED42.p8')}\n`);
        expect(args).toContain('-authenticationKeyID\nDISCOVERED42\n');
        expect(args).toContain('-authenticationKeyIssuerID\nissuer-from-file\n');
        expect(`${result.stdout}${result.stderr}`).not.toContain('issuer-from-file');
        expect(`${result.stdout}${result.stderr}`).not.toContain('private-key');
    });

    it('passes APPLE_API_KEY_PATH straight through', () => {
        const root = fixture([]);
        const path = join(root, 'explicit.p8');
        writeFileSync(path, 'private-key');
        run(root, 'ios-archive.sh', { APPLE_API_KEY_PATH: path, APPLE_API_KEY_ID: 'EXPLICIT7' });
        const args = readFileSync(join(root, 'xcodebuild.args'), 'utf8');
        expect(args).toContain(`-authenticationKeyPath\n${path}\n`);
        expect(args).toContain('-authenticationKeyID\nEXPLICIT7\n');
    });

    it.each([
        ['ios-archive.sh', [], 0],
        ['ios-export.sh', [], 0],
        ['ios-archive.sh', ['FIRST', 'SECOND'], 2],
        ['ios-export.sh', ['FIRST', 'SECOND'], 2],
    ])('%s rejects %s discovered keys', (script, keys, count) => {
        const root = fixture(keys);
        const result = run(root, script);
        expect(result.status).toBe(1);
        expect(result.stderr)
            .toContain(`expected exactly one AuthKey_*.p8 in ${join(root, 'keys')}; found ${count}`);
    });
});
