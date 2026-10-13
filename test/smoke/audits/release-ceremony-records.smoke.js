// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sign.sh refuses an Android set whose ceremony records/ mark a rehearsal,
// a dirty tree or another commit, before it hashes anything.

// Drives the real sign.sh; the stub dev-mock gate after it prints a sentinel,
// so a passing case must reach it and a refused one must not.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
    chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const SIGN = join(root, 'tools/release/sign.sh');
const TAG = 'v9.9.9';
const RESIGN = `${TAG}-resign1`;
const REFUSAL = /ceremony record refuses this signing/;
const SENTINEL = 'STUB DEV-MOCK GATE REACHED';

const work = mkdtempSync(join(tmpdir(), 'ceremony-records-'));

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commitAll = (repo, msg) => {
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.email=smoke@test.invalid', '-c', 'user.name=smoke',
        'commit', '-qm', msg]);
    return git(repo, ['rev-parse', 'HEAD']);
};
// tag.gpgsign=false: a throwaway repo must not inherit a global signed-tag default.
const tag = (repo, name) => git(repo, ['-c', 'tag.gpgsign=false', 'tag', name]);

// A pristine --repo at TAG. With `resign`, a second commit on top is tagged
// RESIGN and checked out, the shape prepare-resign-tag.sh produces.
const makeRepo = ({ resign = false } = {}) => {
    const repo = mkdtempSync(join(work, 'repo-'));
    mkdirSync(join(repo, 'tools', 'release'), { recursive: true });
    mkdirSync(join(repo, 'tools', 'build-reproduce'), { recursive: true });
    for (const f of ['lib.sh', 'sign.sh', 'expected-artifacts.txt',
        'shipped-lanes.txt', 'update-info.mjs', 'verify-signatures.mjs',
        'store-profile-status.txt']) {
        cpSync(join(root, 'tools/release', f), join(repo, 'tools/release', f));
    }
    const gate = join(repo, 'tools/build-reproduce/check-no-dev-mock.sh');
    writeFileSync(gate, `#!/usr/bin/env bash\necho "${SENTINEL}"\nexit 1\n`);
    chmodSync(gate, 0o755);
    git(repo, ['init', '-q', '.']);
    const release = commitAll(repo, 'init');
    tag(repo, TAG);
    if (!resign) return { repo, release, head: release };
    writeFileSync(join(repo, 'tools/release/RESIGN-NOTE.txt'), 'gate replaced\n');
    const head = commitAll(repo, 'resign');
    tag(repo, RESIGN);
    return { repo, release, head };
};

// An android-only staging set, optionally with the ceremony's records.
const stage = ({ record = null, marker = false } = {}) => {
    const dir = mkdtempSync(join(work, 'stage-'));
    writeFileSync(join(dir, 'xchain-wallet-android-v9.9.9.aab'), 'aab\n');
    writeFileSync(join(dir, 'xchain-wallet-v9.9.9.apk'), 'apk\n');
    if (record || marker) mkdirSync(join(dir, 'records'));
    if (record) {
        // Uneven padding, exactly as android-ceremony.sh writes it.
        writeFileSync(join(dir, 'records', 'PROVENANCE.txt'), [
            `tag:        ${record.tag}`,
            `head:       ${record.head}`,
            `tag_commit: ${record.tagCommit}`,
            `dirty_paths: ${record.dirty}`,
            `rehearsal:  ${record.rehearsal}`,
            'profiles:   store',
            'built_at:   2026-01-01T00:00:00Z',
            '',
        ].join('\n'));
    }
    if (marker) {
        writeFileSync(join(dir, 'records', 'DO-NOT-PUBLISH.txt'),
            'REHEARSAL ARTIFACTS. Do not upload to Play, do not publish, delete when done.\n');
    }
    return dir;
};

// XCHAIN_RELEASE_GPG_KEY names a key no keyring holds; nothing here ever signs.
const runSign = (repo, input, signTag = TAG) => {
    try {
        const out = execFileSync('bash', [SIGN, '--tag', signTag, '--repo', repo,
            '--input', input, '--lane', 'android'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, XCHAIN_RELEASE_GPG_KEY: '0'.repeat(40) },
            timeout: 60_000,
        });
        return { ok: true, out };
    } catch (e) {
        return { ok: false, out: `${String(e.stdout || '')}${String(e.stderr || '')}` };
    }
};

const passes = (r, label) => {
    assert.doesNotMatch(r.out, REFUSAL, `${label}: the record gate refused a set it must pass:\n${r.out}`);
    assert.ok(r.out.includes(SENTINEL),
        `${label}: the run never reached the next gate, so this case proves nothing:\n${r.out}`);
};
const refused = (r, label, why) => {
    assert.ok(!r.ok, `${label}: sign.sh must exit non-zero`);
    assert.match(r.out, REFUSAL, `${label}: the record gate did not refuse:\n${r.out}`);
    assert.match(r.out, why, `${label}: the refusal does not name the failed field:\n${r.out}`);
    assert.ok(!r.out.includes(SENTINEL),
        `${label}: a later gate ran, so the refusal did not happen before hashing:\n${r.out}`);
};

const plain = makeRepo();
const good = { tag: TAG, head: plain.release, tagCommit: plain.release, dirty: 0, rehearsal: 'no' };

// --- 1. Sets the gate must pass ------------------------------------------
// A full release set holds Android files copied out of the ceremony directory
// without records/, so absence is not a refusal.
passes(runSign(plain.repo, stage()), 'no records/');
passes(runSign(plain.repo, stage({ record: good })), 'a clean release record at the tag');

// --- 2. What a rehearsal leaves behind is refused ------------------------
refused(runSign(plain.repo, stage({ record: { ...good, rehearsal: 'yes' }, marker: true })),
    'a rehearsal directory as the ceremony writes it', /DO-NOT-PUBLISH\.txt exists/);
refused(runSign(plain.repo, stage({ marker: true })),
    'the marker alone', /DO-NOT-PUBLISH\.txt exists/);
refused(runSign(plain.repo, stage({ record: { ...good, rehearsal: 'yes' } })),
    'rehearsal: yes with the marker deleted', /rehearsal is 'yes'/);
refused(runSign(plain.repo, stage({ record: { ...good, dirty: 3 } })),
    'a dirty build tree', /dirty_paths is '3'/);
refused(runSign(plain.repo, stage({ record: { ...good, tagCommit: 'none' } })),
    'a build of a tag that did not exist', /tag_commit is 'none'/);
refused(runSign(plain.repo, stage({ record: { ...good, head: 'a'.repeat(40) } })),
    'HEAD was not the tag when it built', /head 'a{40}' is not tag_commit/);
refused(runSign(plain.repo, stage({
    record: { ...good, head: 'b'.repeat(40), tagCommit: 'b'.repeat(40) },
})), 'bytes built from another commit', /tag_commit 'b{40}' is not v9\.9\.9/);

// --- 3. A re-sign tag signs its release's record -------------------------
const re = makeRepo({ resign: true });
const reGood = { tag: TAG, head: re.release, tagCommit: re.release, dirty: 0, rehearsal: 'no' };
passes(runSign(re.repo, stage({ record: reGood }), RESIGN), 'a re-sign of the release commit');
refused(runSign(re.repo, stage({
    record: { ...reGood, head: 'c'.repeat(40), tagCommit: 'c'.repeat(40) },
}), RESIGN), 'a re-sign over another commit', /nor its release tag v9\.9\.9/);

rmSync(work, { recursive: true, force: true });

console.log('OK  release ceremony records: sign.sh refuses rehearsal, dirty or off-tag Android '
    + 'records before hashing, and passes a clean record, a re-sign and a set with no records (11 cases)');
