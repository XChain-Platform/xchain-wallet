import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const CHECKER = fileURLToPath(new URL('./check-packaged-manifest.mjs', import.meta.url));
const HASH = 'a'.repeat(64);

function run(args) {
    return spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' });
}

function manifest(lines) {
    return `${lines.map((name) => `${HASH}  ./${name}`).join('\n')}\n`;
}

test('requires a manifest path', () => {
    const result = run([]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage: check-packaged-manifest\.mjs/);
});

test('accepts a complete artifact matrix for the requested architectures', (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'packaged-manifest-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const manifestPath = path.join(root, 'RELEASE_HASHES.txt');
    writeFileSync(manifestPath, manifest([
        'xchain-wallet-1.2.3-x86_64.AppImage',
        'xchain-wallet-1.2.3-arm64.AppImage',
        'xchain-wallet_1.2.3_amd64.deb',
        'xchain-wallet_1.2.3_arm64.deb',
    ]));

    const result = run([manifestPath, 'x64', 'arm64']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /AppImage \+ deb for x64, arm64/);
});

test('rejects a short manifest even when every listed hash is valid', (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'packaged-manifest-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const manifestPath = path.join(root, 'RELEASE_HASHES.txt');
    writeFileSync(manifestPath, manifest([
        'xchain-wallet-1.2.3-arm64.AppImage',
        'xchain-wallet_1.2.3_amd64.deb',
        'xchain-wallet_1.2.3_arm64.deb',
    ]));

    const result = run([manifestPath, 'x64', 'arm64']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /no AppImage artifact for x64/);
    assert.match(result.stderr, /verifies clean/i);
});
