import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const TOOL = fileURLToPath(new URL('./release-record.mjs', import.meta.url));
const TEMPLATE = `# XChain Wallet release record - vX.Y.Z

Copy this file to vX.Y.Z.md and fill fields in as facts become known.

**Version:** X.Y.Z
**Tag:** vX.Y.Z
**Opened:**
**Release manager:**
**Closed:** not closed
**Store integers:** Derived from the wallet version.
`;

function fixture(t) {
    const records = mkdtempSync(path.join(tmpdir(), 'release-record-test-'));
    t.after(() => rmSync(records, { recursive: true, force: true }));
    writeFileSync(path.join(records, 'TEMPLATE.md'), TEMPLATE);
    return records;
}

function run(records, args) {
    return spawnSync(process.execPath, [TOOL, ...args], {
        encoding: 'utf8',
        env: { ...process.env, XCHAIN_WALLET_RELEASE_RECORDS: records },
    });
}

test('parses help and rejects an invalid tag', (t) => {
    const records = fixture(t);
    const help = run(records, ['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /open --tag <vX\.Y\.Z>/);

    const invalid = run(records, ['path', '--tag', 'next']);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /--tag must be vX\.Y\.Z/);
});

test('instantiates a release record and accepts the resulting document', (t) => {
    const records = fixture(t);

    const opened = run(records, [
        'open', '--tag', 'v1.2.3', '--manager', 'Release Person',
    ]);

    assert.equal(opened.status, 0, opened.stderr);
    const recordPath = path.join(records, 'v1.2.3.md');
    const body = readFileSync(recordPath, 'utf8');
    assert.match(body, /^# XChain Wallet release record - v1\.2\.3/m);
    assert.match(body, /^\*\*Version:\*\* 1\.2\.3/m);
    assert.match(body, /^\*\*Tag:\*\* v1\.2\.3/m);
    assert.match(body, /^\*\*Release manager:\*\* Release Person/m);
    assert.doesNotMatch(body, /^Copy this file to /m);

    const accepted = run(records, ['assert', '--tag', 'v1.2.3']);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /release record .*v1\.2\.3\.md \(open\)/);

    const duplicate = run(records, ['open', '--tag', 'v1.2.3']);
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /already exists; this never overwrites/);
});
