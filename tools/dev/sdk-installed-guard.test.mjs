import assert from 'node:assert/strict';
import {
    mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const GUARD = fileURLToPath(new URL('./sdk-installed-guard.mjs', import.meta.url));
const SHELLS = ['web', 'extension', 'desktop'];

function lockfile(version = '0.21.3') {
    const importers = SHELLS.map((shell) => `  packages/${shell}:\n    dependencies:\n      xchain-sdk:\n        specifier: npm:@dankest-llc/xchain-sdk@${version}\n        version: '@dankest-llc/xchain-sdk@${version}'`).join('\n\n');
    return `lockfileVersion: '9.0'\n\nimporters:\n\n${importers}\n`;
}

function writePackage(packagePath, version) {
    mkdirSync(packagePath, { recursive: true });
    writeFileSync(path.join(packagePath, 'package.json'), `${JSON.stringify({
        name: '@dankest-llc/xchain-sdk',
        version,
    }, null, 2)}\n`);
}

function fixture(version = '0.21.3') {
    const root = mkdtempSync(path.join(tmpdir(), 'sdk-installed-guard-'));
    writeFileSync(path.join(root, 'pnpm-lock.yaml'), lockfile(version));
    for (const shell of SHELLS) {
        writePackage(path.join(root, 'packages', shell, 'node_modules', 'xchain-sdk'), version);
    }
    return root;
}

function run(root) {
    return spawnSync(process.execPath, [GUARD, '--root', root], { encoding: 'utf8' });
}

test('accepts installed SDK versions that match each lockfile pin', (t) => {
    const root = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(root);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /web: xchain-sdk 0\.21\.3 matches the lockfile/);
    assert.match(result.stdout, /extension: xchain-sdk 0\.21\.3 matches the lockfile/);
    assert.match(result.stdout, /desktop: xchain-sdk 0\.21\.3 matches the lockfile/);
});

test('rejects an installed SDK version that differs from the lockfile pin', (t) => {
    const root = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writePackage(path.join(root, 'packages', 'extension', 'node_modules', 'xchain-sdk'), '0.22.0');

    const result = run(root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /extension: installed xchain-sdk 0\.22\.0 does not match lockfile 0\.21\.3/);
});

test('rejects a missing installed SDK', (t) => {
    const root = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    rmSync(path.join(root, 'packages', 'desktop', 'node_modules', 'xchain-sdk'), { recursive: true });

    const result = run(root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /desktop: xchain-sdk is not installed \(lockfile 0\.21\.3\)/);
});

test('exempts an sdk:link development symlink', (t) => {
    const root = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const live = path.join(root, 'packages', 'web', 'node_modules', 'xchain-sdk');
    const checkout = path.join(root, 'xchain-sdk-checkout');
    rmSync(live, { recursive: true });
    writePackage(checkout, '9.9.9');
    symlinkSync(checkout, live, 'dir');

    const result = run(root);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /web: sdk:link development link exempt/);
});

test('rejects a broken development symlink', (t) => {
    const root = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const live = path.join(root, 'packages', 'web', 'node_modules', 'xchain-sdk');
    rmSync(live, { recursive: true });
    symlinkSync(path.join(root, 'missing-sdk-checkout'), live, 'dir');

    const result = run(root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /web: xchain-sdk is not installed \(lockfile 0\.21\.3\)/);
});

test('does not exempt pnpm installed-package symlinks', (t) => {
    const root = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const live = path.join(root, 'packages', 'web', 'node_modules', 'xchain-sdk');
    const storePackage = path.join(root, 'node_modules', '.pnpm', '@dankest-llc+xchain-sdk@0.22.0', 'node_modules', 'xchain-sdk');
    rmSync(live, { recursive: true });
    writePackage(storePackage, '0.22.0');
    symlinkSync(path.relative(path.dirname(live), storePackage), live, 'dir');

    const result = run(root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /web: installed xchain-sdk 0\.22\.0 does not match lockfile 0\.21\.3/);
});

test('fails closed when an importer lockfile pin is missing', (t) => {
    const root = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(path.join(root, 'pnpm-lock.yaml'), lockfile().replace('      xchain-sdk:', '      renamed-sdk:'));

    const result = run(root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /lockfile web importer has no xchain-sdk entry/);
});
