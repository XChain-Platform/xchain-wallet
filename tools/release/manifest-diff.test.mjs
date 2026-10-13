import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const TOOL = fileURLToPath(new URL('./manifest-diff.mjs', import.meta.url));

function fixture(t, ours, theirs) {
    const root = mkdtempSync(path.join(tmpdir(), 'manifest-diff-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const oursPath = path.join(root, 'ours.json');
    const theirsPath = path.join(root, 'theirs.json');
    writeFileSync(oursPath, `${JSON.stringify(ours, null, 2)}\n`);
    writeFileSync(theirsPath, `${JSON.stringify(theirs, null, 2)}\n`);
    return { oursPath, theirsPath };
}

function run(args) {
    return spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
}

test('prints help and rejects a missing file argument', () => {
    const help = run(['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--ignore <keys>/);

    const missing = run([]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /Usage: node manifest-diff\.mjs/);
});

test('ignores only the configured top-level store fields', (t) => {
    const { oursPath, theirsPath } = fixture(t,
        { name: 'Wallet', version: '1.2.3', nested: { enabled: true } },
        {
            nested: { enabled: true }, version: '1.2.3', name: 'Wallet',
            update_url: 'https://store.invalid/update', key: 'store-key',
        });

    const defaults = run([oursPath, theirsPath]);
    assert.equal(defaults.status, 0, defaults.stderr);
    assert.match(defaults.stdout, /ignored keys: update_url, key/);

    const strict = run([oursPath, theirsPath, '--ignore', 'key']);
    assert.equal(strict.status, 1);
    assert.match(strict.stderr, /update_url: missing on our side/);
});

test('reports the path of a nested transformation mismatch', (t) => {
    const { oursPath, theirsPath } = fixture(t,
        { content_scripts: [{ matches: ['https://one.invalid/*'] }] },
        { content_scripts: [{ matches: ['https://two.invalid/*'] }] });

    const result = run([oursPath, theirsPath]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /content_scripts\[0\]\.matches\[0\]/);
    assert.match(result.stderr, /one\.invalid/);
    assert.match(result.stderr, /two\.invalid/);
});
