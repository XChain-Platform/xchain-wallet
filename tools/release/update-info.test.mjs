import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const TOOL = fileURLToPath(new URL('./update-info.mjs', import.meta.url));
const POINTER = `version: 1.2.3
files:
  - url: xchain-wallet-1.2.3.AppImage
    sha512: encoded
path: xchain-wallet-1.2.3.AppImage
sha512: encoded
`;

function fixture(t) {
    const root = mkdtempSync(path.join(tmpdir(), 'update-info-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(path.join(root, 'stable-linux.yml'), POINTER);
    writeFileSync(path.join(root, 'builder-debug.yml'), 'x64:\n  patterns: []\n');
    writeFileSync(path.join(root, 'xchain-wallet-1.2.3.AppImage'), 'artifact bytes\n');
    writeFileSync(path.join(root, 'RELEASE_HASHES.txt'), 'manifest\n');
    const resources = path.join(root, 'linux-unpacked', 'resources');
    mkdirSync(resources, { recursive: true });
    writeFileSync(path.join(resources, 'app-update.yml'),
        'provider: generic\nurl: https://downloads.invalid/wallet/\nchannel: stable\n');
    return root;
}

function run(args) {
    return spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
}

test('parses help and rejects an unknown command', (t) => {
    const root = fixture(t);
    const help = run(['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /classify <dir>/);

    const unknown = run(['invent', root]);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /unknown command "invent"/);
});

test('classifies release output by content and builds an ordered checklist', (t) => {
    const root = fixture(t);

    const classified = run(['classify', root]);

    assert.equal(classified.status, 0, classified.stderr);
    assert.match(classified.stdout, /channel pointers \(1\)[\s\S]*stable-linux\.yml/);
    assert.match(classified.stdout, /artifacts \(1\)[\s\S]*xchain-wallet-1\.2\.3\.AppImage/);
    assert.match(classified.stdout, /manifest \(1\)[\s\S]*RELEASE_HASHES\.txt/);
    assert.match(classified.stdout,
        /build byproducts \(never published\) \(1\)[\s\S]*builder-debug\.yml/);

    const checklist = run(['checklist', root, '--tag', 'v1.2.3']);
    assert.equal(checklist.status, 0, checklist.stderr);
    assert.match(checklist.stdout, /Publish checklist for v1\.2\.3/);
    assert.ok(checklist.stdout.indexOf('xchain-wallet-1.2.3.AppImage')
        < checklist.stdout.indexOf('stable-linux.yml'));
});

test('checks the feed and channel embedded in a packaged app', (t) => {
    const root = fixture(t);

    const accepted = run([
        'assert-feed', root,
        '--url', 'https://downloads.invalid/wallet/',
        '--channel', 'stable',
    ]);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /stable @ https:\/\/downloads\.invalid\/wallet\//);

    const refused = run([
        'assert-feed', root,
        '--url', 'https://staging.invalid/wallet/',
        '--channel', 'staging',
    ]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /expected "https:\/\/staging\.invalid\/wallet\/"/);
    assert.match(refused.stderr, /expected "staging"/);
});
