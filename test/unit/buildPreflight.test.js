// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import {
    mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'tools', 'build-preflight.js');
const VERSION = '1.2.3';

function write(root, path, contents) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
}

function json(value) {
    return `${JSON.stringify(value, null, 4)}\n`;
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'build-preflight-'));
    write(root, 'package.json', json({ name: 'fixture', version: VERSION }));
    for (const name of ['core', 'desktop', 'extension', 'mobile']) {
        write(root, `packages/${name}/package.json`, json({
            name: `@fixture/${name}`,
            version: VERSION,
        }));
    }
    write(root, 'packages/core/plugins/example/package.json', json({
        name: '@fixture/example-plugin',
        version: VERSION,
    }));
    write(root, 'packages/extension/manifest.json', json({
        manifest_version: 3,
        version: VERSION,
    }));
    write(root, 'packages/mobile/android/app/build.gradle', `
def versionProps = new Properties()
versionCode versionProps['versionCode'].toInteger()
versionName versionProps['versionName']
`);
    write(root, 'packages/mobile/ios/App/App.xcodeproj/project.pbxproj', `
baseConfigurationReference = ABC123 /* Version.xcconfig */;
`);
    write(root, 'CHANGELOG.md', `# Changelog\n\n## [${VERSION}] - 2026-10-13\n`);
    return root;
}

function run(root) {
    return spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
}

describe('build preflight', () => {
    it('passes a consistent fixture without modifying its files', () => {
        const root = fixture();
        try {
            const tracked = [
                'package.json',
                'packages/core/package.json',
                'packages/core/plugins/example/package.json',
                'packages/desktop/package.json',
                'packages/extension/package.json',
                'packages/extension/manifest.json',
                'packages/mobile/package.json',
                'packages/mobile/android/app/build.gradle',
                'packages/mobile/ios/App/App.xcodeproj/project.pbxproj',
                'CHANGELOG.md',
            ];
            const before = tracked.map((path) => readFileSync(join(root, path), 'utf8'));
            const result = run(root);

            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout.trim().split('\n')).toHaveLength(8);
            expect(result.stdout).toContain('PASS package versions: 5 packages match 1.2.3');
            expect(result.stdout).toContain('PASS Android versionCode: 10020350 matches 1.2.3');
            expect(result.stdout).toContain('PASS iOS CURRENT_PROJECT_VERSION: 10020350 matches 1.2.3');
            expect(tracked.map((path) => readFileSync(join(root, path), 'utf8'))).toEqual(before);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('reports every mismatch and exits nonzero', () => {
        const root = fixture();
        try {
            write(root, 'packages/core/package.json', json({ name: '@fixture/core', version: '1.2.2' }));
            write(root, 'packages/desktop/package.json', json({ name: '@fixture/desktop', version: '1.2.2' }));
            write(root, 'packages/extension/manifest.json', json({
                manifest_version: 3,
                version: '1.2.2',
            }));
            write(root, 'packages/mobile/android/app/build.gradle', `
versionCode 7
versionName "1.2.2"
`);
            write(root, 'packages/mobile/ios/App/App.xcodeproj/project.pbxproj', `
MARKETING_VERSION = 1.2.2;
CURRENT_PROJECT_VERSION = 7;
`);
            write(root, 'CHANGELOG.md', '# Changelog\n\n## [1.2.2]\n');
            const result = run(root);

            expect(result.status).toBe(1);
            expect(result.stderr).toBe('');
            expect(result.stdout.trim().split('\n')).toHaveLength(8);
            expect(result.stdout.match(/^FAIL /gm)).toHaveLength(8);
            expect(result.stdout).toContain('FAIL package versions:');
            expect(result.stdout).toContain('FAIL Android versionCode:');
            expect(result.stdout).toContain('FAIL Android versionName:');
            expect(result.stdout).toContain('FAIL iOS MARKETING_VERSION:');
            expect(result.stdout).toContain('FAIL iOS CURRENT_PROJECT_VERSION:');
            expect(result.stdout).toContain('FAIL desktop package version:');
            expect(result.stdout).toContain('FAIL extension manifest version:');
            expect(result.stdout).toContain('FAIL CHANGELOG heading:');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects stale generated mobile version files', () => {
        const root = fixture();
        try {
            write(root, 'packages/mobile/android/version.properties', `
versionCode=7
versionName=${VERSION}
`);
            write(root, 'packages/mobile/ios/App/Version.xcconfig', `
MARKETING_VERSION = ${VERSION}
CURRENT_PROJECT_VERSION = 7
`);
            const result = run(root);

            expect(result.status).toBe(1);
            expect(result.stdout).toContain('FAIL Android versionCode: generated versionCode is "7"');
            expect(result.stdout).toContain(
                'FAIL iOS CURRENT_PROJECT_VERSION: generated CURRENT_PROJECT_VERSION is "7"',
            );
            expect(result.stdout.match(/^FAIL /gm)).toHaveLength(2);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
