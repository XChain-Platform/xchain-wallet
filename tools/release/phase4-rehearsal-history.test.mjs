// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
    ancestry, classifyHistory, contentHashes, drift, signingPathFiles,
} from './phase4-rehearsal.mjs';

const SIGN = 'tools/release/sign.sh';

// Run git in a throwaway repo with a fixed identity and no signing or hooks,
// so a developer's global config cannot change the fixture's history.
function git(root, args) {
    const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
}

function commitSign(root, body) {
    writeFileSync(join(root, SIGN), body);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', body.trim()]);
    return git(root, ['rev-parse', 'HEAD']);
}

// Base B, pinned P on top of B, and a pin file outside the repo recording P's bytes.
function pinnedFixture(work) {
    const root = join(work, 'repo');
    const files = signingPathFiles('release', 2).script;
    for (const p of files) {
        mkdirSync(dirname(join(root, p)), { recursive: true });
        writeFileSync(join(root, p), `${p}\n`);
    }
    git(root, ['init', '-q', '.']);
    const base = commitSign(root, 'base\n');
    const pinned = commitSign(root, 'pinned\n');
    const pinFile = join(work, 'pin.json');
    writeFileSync(pinFile, JSON.stringify({
        pinFormat: 2, releaseSet: 'release', tag: 'v0.0.0', reached: 'manifest-written',
        scriptRef: pinned, repoRef: pinned, scriptPath: contentHashes(root, files), repoPath: {},
    }));
    return { root, base, pinned, pinFile };
}

test('the rehearsal exemption requires HEAD to be strictly behind the pin', () => {
    assert.deepEqual(classifyHistory(1, 'not-ancestor', 'ancestor'), {
        behind: true,
        diverged: false,
    });
    assert.deepEqual(classifyHistory(1, 'not-ancestor', 'not-ancestor'), {
        behind: false,
        diverged: true,
    });
    assert.deepEqual(classifyHistory(1, 'ancestor', 'not-ancestor'), {
        behind: false,
        diverged: false,
    });
    assert.deepEqual(classifyHistory(1, 'unknown', 'unknown'), {
        behind: false,
        diverged: false,
    });
    assert.deepEqual(classifyHistory(0, 'not-ancestor', 'ancestor'), {
        behind: false,
        diverged: false,
    });
});

test('drift exempts only a checkout strictly behind the pin, never a split or ahead history', () => {
    const work = mkdtempSync(join(tmpdir(), 'phase4-ancestry-'));
    try {
        const { root, base, pinned, pinFile } = pinnedFixture(work);

        git(root, ['checkout', '-q', '--detach', base]);
        assert.equal(ancestry(root, pinned, 'HEAD'), 'not-ancestor');
        const behind = drift({ pinFile, root });
        assert.equal(behind.behind, true, 'a checkout strictly behind the pin keeps the exemption');
        assert.equal(behind.ok, true);
        assert.equal(behind.diverged, false);

        commitSign(root, 'split\n');
        const split = drift({ pinFile, root });
        assert.equal(split.behind, false, 'a split history must never read as behind');
        assert.equal(split.ok, false, 'unrehearsed signing changes on a split history are drift');
        assert.equal(split.diverged, true);
        assert.ok(split.moved.some((m) => m.path === SIGN));

        git(root, ['checkout', '-q', '--detach', pinned]);
        commitSign(root, 'ahead\n');
        const ahead = drift({ pinFile, root });
        assert.equal(ahead.behind, false, 'a checkout past the pin is never behind');
        assert.equal(ahead.ok, false);
        assert.equal(ahead.diverged, false);
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
});

test('drift treats an unresolvable pinned commit as drift, not as behind', () => {
    const work = mkdtempSync(join(tmpdir(), 'phase4-ancestry-'));
    try {
        const { root, base, pinFile } = pinnedFixture(work);
        git(root, ['checkout', '-q', '--detach', base]);
        const missing = join(work, 'missing-ref.json');
        writeFileSync(missing, JSON.stringify({
            pinFormat: 2, releaseSet: 'release', scriptRef: 'f'.repeat(40), repoRef: 'f'.repeat(40),
            scriptPath: drift({ pinFile, root }).pin.scriptPath, repoPath: {},
        }));
        const d = drift({ pinFile: missing, root });
        assert.equal(d.behind, false);
        assert.equal(d.ok, false);
        assert.equal(d.diverged, false);
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
});
