import assert from 'node:assert/strict';
import {
    copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SOURCE = fileURLToPath(new URL('./bump-version.mjs', import.meta.url));
const CURRENT = '1.2.3';
const PACKAGES = ['core', 'extension', 'future-shell'];

function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'bump-version-test-'));
    const toolDir = path.join(root, 'tools', 'release');
    mkdirSync(toolDir, { recursive: true });
    copyFileSync(SOURCE, path.join(toolDir, 'bump-version.mjs'));
    writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
        name: 'fixture', version: CURRENT,
    }, null, 4)}\n`);
    for (const name of PACKAGES) {
        const dir = path.join(root, 'packages', name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
            name: `@fixture/${name}`, version: CURRENT,
        }, null, 4)}\n`);
    }
    mkdirSync(path.join(root, 'packages', 'core', 'src'), { recursive: true });
    writeFileSync(path.join(root, 'packages', 'core', 'src', 'buildInfo.js'),
        `export const WALLET_VERSION = '${CURRENT}';\n`);
    writeFileSync(path.join(root, 'packages', 'extension', 'manifest.json'), `${JSON.stringify({
        manifest_version: 3,
        version: CURRENT,
        version_name: CURRENT,
    }, null, 4)}\n`);
    writeFileSync(path.join(root, 'README.md'),
        `<img src="https://img.shields.io/badge/version-${CURRENT}-blue" alt="Version">\n\n`
        + `Pre-v2.0 (current version: \`${CURRENT}\`).\n`);
    writeFileSync(path.join(root, 'CHANGELOG.md'), `# Changelog

## [Unreleased]

### Fixed
- Exercise the release transformation.

## [${CURRENT}] - 2026-01-01

- Previous release.
`);
    return { root, tool: path.join(toolDir, 'bump-version.mjs') };
}

function run(tool, args) {
    return spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
}

test('parses help, date, and dry-run without changing the fixture', (t) => {
    const { root, tool } = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const help = run(tool, ['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /usage: bump-version\.mjs/);

    const before = readFileSync(path.join(root, 'package.json'), 'utf8');
    const dryRun = run(tool, ['v1.3.0', '--date', '2026-10-13', '--dry-run']);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /dry run, nothing written/);
    assert.match(dryRun.stdout, /1\.2\.3 -> 1\.3\.0/);
    assert.equal(readFileSync(path.join(root, 'package.json'), 'utf8'), before);

    const invalid = run(tool, ['1.3.0', '--date', '13-10-2026']);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /is not YYYY-MM-DD/);
});

test('updates every derived version declaration and promotes the changelog', (t) => {
    const { root, tool } = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(tool, ['1.3.0', '--date', '2026-10-13']);

    assert.equal(result.status, 0, result.stderr);
    for (const rel of [
        'package.json',
        ...PACKAGES.map((name) => path.join('packages', name, 'package.json')),
    ]) {
        assert.equal(JSON.parse(readFileSync(path.join(root, rel), 'utf8')).version, '1.3.0');
    }
    const manifest = JSON.parse(readFileSync(
        path.join(root, 'packages', 'extension', 'manifest.json'), 'utf8',
    ));
    assert.equal(manifest.version, '1.3.0');
    assert.equal(manifest.version_name, '1.3.0');
    assert.match(readFileSync(path.join(root, 'packages', 'core', 'src', 'buildInfo.js'), 'utf8'),
        /WALLET_VERSION = '1\.3\.0'/);
    const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, /badge\/version-1\.3\.0-blue/);
    assert.match(readme, /current version: `1\.3\.0`/);
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /## \[Unreleased\]\n\n## \[1\.3\.0\] - 2026-10-13/);
    assert.match(changelog, /Exercise the release transformation/);
});
