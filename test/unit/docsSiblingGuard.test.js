// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// test/smoke/_docs-repo.js decides whether ~20 docs-coupled smokes run, skip,
// or fail.: it used to SKIP whenever the sibling checkout was absent,
// which made a broken CI harness (a push from a linked worktree shipped the
// WRONG repository into the xchain-documentation slot) indistinguishable from a
// healthy one: every docs smoke skipped and the gate reported GREEN.
//
// The rule is now declaration-driven: .ci-siblings names xchain-documentation,
// so the harness is contracted to ship it and its absence is a red. These cases
// pin that, and pin the two deliberate escapes.
//
// The refusal path calls process.exit(1), so it is exercised in a CHILD process:
// asserting on the real exit code is the whole point, and a stubbed exit would
// pin the stub instead.

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// vitest anchors its root to the wallet repo, so cwd is the repo root (see
// test/vitest/unit.config.js). import.meta.url is not a file: URL under the
// transform, so it cannot be used here.
const WS_ROOT = process.cwd();
const HELPER = join(WS_ROOT, 'test', 'smoke', '_docs-repo.js');

/** A docs sibling that does (or does not) carry components/wallet. */
function makeDocsRoot({ withWalletDocs, packageName = 'xchain-documentation' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'docs-sibling-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: packageName }));
    if (withWalletDocs) {
        mkdirSync(join(dir, 'components', 'wallet'), { recursive: true });
        writeFileSync(join(dir, 'components', 'wallet', 'index.md'), '# wallet\n');
    }
    return dir;
}

/**
 * Import the helper in a child process and report what docsAvailable() did:
 * `true`/`false` on stdout for a verdict, or a non-zero exit for a refusal.
 */
function probe(env) {
    const script = `import { docsAvailable } from ${JSON.stringify(HELPER)};`
        + 'process.stdout.write(String(docsAvailable()));';
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
        cwd: WS_ROOT,
        env: { ...process.env, XCHAIN_DOCS_ROOT: '', XCHAIN_DOCS_OPTIONAL: '', ...env },
    });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

describe('docs sibling guard @regression', () => {
    it('this repo declares the docs sibling, so its absence is a harness failure', () => {
        // If this ever stops being true the guard below correctly relaxes to a
        // skip, so assert the premise rather than let it rot silently.
        const declared = execFileSync(process.execPath, [
            '--input-type=module', '-e',
            `import { docsDeclared } from ${JSON.stringify(HELPER)};`
            + 'process.stdout.write(String(docsDeclared()));',
        ], { encoding: 'utf8', cwd: WS_ROOT });
        expect(declared).toBe('true');
    });

    it('passes when the sibling carries the wallet docs', () => {
        const dir = makeDocsRoot({ withWalletDocs: true });
        try {
            const r = probe({ XCHAIN_DOCS_ROOT: dir });
            expect(r.status).toBe(0);
            expect(r.stdout).toBe('true');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('REFUSES when the declared sibling slot is empty', () => {
        const dir = join(tmpdir(), `docs-sibling-absent-${Date.now()}`);
        expect(existsSync(dir)).toBe(false);
        const r = probe({ XCHAIN_DOCS_ROOT: dir });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/DECLARED in \.ci-siblings but unreachable/);
        expect(r.stderr).toMatch(/nothing is there/);
    });

    it('REFUSES, naming the occupant, when the slot holds the WRONG repository', () => {
        // The exact 2026-08-03 shape: the wallet's own checkout shipped into the
        // xchain-documentation slot. Present, a real repo, and no docs in it.
        const dir = makeDocsRoot({ withWalletDocs: false, packageName: 'xchain-wallet' });
        try {
            const r = probe({ XCHAIN_DOCS_ROOT: dir });
            expect(r.status).toBe(1);
            expect(r.stderr).toMatch(/holds a checkout of 'xchain-wallet'/);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('XCHAIN_DOCS_OPTIONAL=1 is the deliberate way back to the old skip', () => {
        const dir = join(tmpdir(), `docs-sibling-absent-opt-${Date.now()}`);
        const r = probe({ XCHAIN_DOCS_ROOT: dir, XCHAIN_DOCS_OPTIONAL: '1' });
        expect(r.status).toBe(0);
        expect(r.stdout).toBe('false');
    });

    // --- the tree the assertions actually read (frontier row 123) ---
    //
    // Present is not the same as current. These are shared checkouts, and on
    // 2026-08-08 the same smoke at the same commit was RED against the sibling
    // and GREEN against a clean worktree of docs origin/master, with nothing
    // saying the two runs had read different bytes.

    /**
     * A docs sibling that is a real git repo, so tree state is answerable.
     * `dirtyWhere` picks which component the uncommitted edit lands under,
     * because only the wallet's own is this notice's business.
     */
    function makeGitDocsRoot({ dirty = false, dirtyWhere = 'components/wallet' } = {}) {
        const dir = makeDocsRoot({ withWalletDocs: true });
        const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
        // -c overrides so a global commit.gpgsign / user config cannot make
        // this fixture fail for reasons that are not the fixture.
        git('init', '-q', '-b', 'master');
        git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false',
            'add', '-A');
        git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false',
            'commit', '-qm', 'fixture');
        if (dirty) {
            mkdirSync(join(dir, dirtyWhere), { recursive: true });
            writeFileSync(join(dir, dirtyWhere, 'index.md'), '# edited\n');
        }
        return dir;
    }

    /**
     * A docs sibling CLONED from an origin that has since moved on, which is
     * the shared checkout's other ordinary state and the one no fixture above
     * can reach: without a real origin, `behind` is unanswerable by design.
     *
     * `where` picks which path the origin-only commit touches, because the
     * scoping is the claim: `components/wallet` must be reported and anything
     * else must not.
     */
    function makeDocsRootBehindOrigin({ where = 'components/wallet' } = {}) {
        const origin = makeGitDocsRoot();
        const dir = mkdtempSync(join(tmpdir(), 'docs-sibling-clone-'));
        rmSync(dir, { recursive: true, force: true });        // clone wants it absent
        execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' });

        // Commit in the ORIGIN only, then fetch, so the clone knows it is behind
        // without having the commit. Same shape as a sibling nobody has pulled.
        mkdirSync(join(origin, where), { recursive: true });
        writeFileSync(join(origin, where, 'added.md'), '# added upstream\n');
        execFileSync('git', ['-C', origin, '-c', 'user.email=t@t', '-c', 'user.name=t',
            '-c', 'commit.gpgsign=false', 'add', '-A'], { stdio: 'ignore' });
        execFileSync('git', ['-C', origin, '-c', 'user.email=t@t', '-c', 'user.name=t',
            '-c', 'commit.gpgsign=false', 'commit', '-qm', 'upstream'], { stdio: 'ignore' });
        execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin'], { stdio: 'ignore' });
        return { dir, origin };
    }

    /** Report docsTreeState()/noteDocsTreeState() for a given docs root. */
    function treeProbe(root, env = {}) {
        const script = `import { docsTreeState, noteDocsTreeState } from ${JSON.stringify(HELPER)};`
            + 'const s = docsTreeState();'
            + 'const seen = [];'
            + 'noteDocsTreeState({ err: (m) => seen.push(m) });'
            + 'noteDocsTreeState({ err: (m) => seen.push(m) });'
            + 'process.stdout.write(JSON.stringify({ ...s, notices: seen.length, text: seen[0] || "" }));';
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            encoding: 'utf8',
            cwd: WS_ROOT,
            // Cleared, not inherited: an ancestor runner in the ambient
            // environment would otherwise suppress the notice and fail these
            // for a reason that is not the code.
            env: {
                ...process.env,
                XCHAIN_DOCS_ROOT: root,
                XCHAIN_DOCS_OPTIONAL: '',
                XCHAIN_DOCS_TREE_NOTED: '',
                ...env,
            },
        });
        return JSON.parse(r.stdout || '{}');
    }

    it('a clean, current docs checkout says nothing at all', () => {
        const dir = makeGitDocsRoot();
        try {
            const s = treeProbe(dir);
            expect(s.git).toBe(true);
            expect(s.dirty).toEqual([]);
            // No origin at all, so "behind" is unanswerable and must stay null
            // rather than becoming a guess or an error.
            expect(s.behind).toBeNull();
            expect(s.notices).toBe(0);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('an uncommitted edit under components/wallet is reported by name', () => {
        const dir = makeGitDocsRoot({ dirty: true });
        try {
            const s = treeProbe(dir);
            expect(s.dirty.length).toBe(1);
            expect(s.notices).toBe(1);
            expect(s.text).toMatch(/uncommitted change/);
            // The notice must name the tree, because naming it is the whole
            // point: a reader has to know which bytes produced the verdict.
            expect(s.text).toContain(dir);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('the notice prints once per process, however many smokes ask', () => {
        const dir = makeGitDocsRoot({ dirty: true });
        try {
            // treeProbe calls noteDocsTreeState twice; 28 files come through
            // docsAvailable() and 28 copies of one notice is how a real signal
            // gets filtered out.
            expect(treeProbe(dir).notices).toBe(1);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('a docs root that is not a git checkout is silent, not an error', () => {
        const dir = makeDocsRoot({ withWalletDocs: true });   // no git init
        try {
            const s = treeProbe(dir);
            expect(s.git).toBe(false);
            expect(s.notices).toBe(0);
            // Not "git is unavailable here": a directory that is not a
            // checkout makes git exit non-zero, and reporting that as a
            // missing binary sends a reader to install a tool they have.
            expect(s.reason).toMatch(/not a git checkout/);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('an uncommitted edit OUTSIDE components/wallet stays silent', () => {
        // Same scoping claim as the behind case, on the other half. The docs
        // repo serves every component, so a notice that fired on an indexer
        // edit would fire on nearly every run and stop being read.
        const dir = makeGitDocsRoot({ dirty: true, dirtyWhere: 'components/indexer' });
        try {
            const s = treeProbe(dir);
            expect(s.dirty).toEqual([]);
            expect(s.notices).toBe(0);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('a docs tree behind origin/master under components/wallet is reported', () => {
        // The half the dirty cases cannot see: this is the state that made a
        // smoke RED against the sibling and GREEN at the same wallet commit
        // against a clean worktree of docs origin/master.
        const { dir, origin } = makeDocsRootBehindOrigin();
        try {
            const s = treeProbe(dir);
            expect(s.dirty).toEqual([]);              // clean, and still not current
            expect(s.behind).toBe('1 commit(s)');
            expect(s.notices).toBe(1);
            expect(s.text).toMatch(/behind origin\/master/);
            expect(s.text).toContain(dir);
        } finally {
            rmSync(dir, { recursive: true, force: true });
            rmSync(origin, { recursive: true, force: true });
        }
    });

    it('a docs tree behind only OUTSIDE components/wallet stays silent', () => {
        // The scoping is what keeps the notice worth reading: the docs repo
        // serves every component, so reporting an indexer-only commit would
        // fire on nearly every run and train readers to skip past it.
        const { dir, origin } = makeDocsRootBehindOrigin({ where: 'components/indexer' });
        try {
            const s = treeProbe(dir);
            expect(s.behind).toBeNull();
            expect(s.notices).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
            rmSync(origin, { recursive: true, force: true });
        }
    });

    it('a caller that already reported the tree silences its children', () => {
        // The state is still observed, it is just not said twice. Without this,
        // the suite printed 24 copies of one notice (measured 2026-08-08), which
        // is how a real signal gets filtered out.
        const dir = makeGitDocsRoot({ dirty: true });
        try {
            const s = treeProbe(dir, { XCHAIN_DOCS_TREE_NOTED: '1' });
            expect(s.dirty.length).toBe(1);
            expect(s.notices).toBe(0);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('a run that spawns many smokes says it once, not once per smoke', () => {
        // The end of the claim no single-process case can reach. Reproduces the
        // runner's shape (announce, flag, spawn) rather than invoking the real
        // suite, which would put 400-odd smokes inside the unit suite; the
        // structural case below pins that the runner is actually wired this way.
        const dir = makeGitDocsRoot({ dirty: true });
        try {
            const child = `import { noteDocsTreeState } from ${JSON.stringify(HELPER)};`
                + 'noteDocsTreeState();';
            const parent = `import { noteDocsTreeState } from ${JSON.stringify(HELPER)};`
                + 'import { spawnSync } from "node:child_process";'
                + 'noteDocsTreeState();'
                + 'process.env.XCHAIN_DOCS_TREE_NOTED = "1";'
                + `for (let i = 0; i < 3; i += 1) spawnSync(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(child)}], { stdio: "inherit" });`;
            const r = spawnSync(process.execPath, ['--input-type=module', '-e', parent], {
                encoding: 'utf8',
                cwd: WS_ROOT,
                env: {
                    ...process.env,
                    XCHAIN_DOCS_ROOT: dir,
                    XCHAIN_DOCS_OPTIONAL: '',
                    XCHAIN_DOCS_TREE_NOTED: '',
                },
            });
            const notices = (`${r.stdout}${r.stderr}`.match(/^NOTICE: the docs assertions/gm) || []).length;
            expect(notices).toBe(1);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('the smoke runner announces the docs tree before it spawns anything', () => {
        // The coupling the simulation above assumes. A structural check, because
        // running the real suite here would cost minutes; it fails loudly if
        // someone drops either half of the wiring.
        const runner = readFileSync(join(WS_ROOT, 'test', 'smoke', '_run-smokes.js'), 'utf8');
        const announce = runner.indexOf('noteDocsTreeState()');
        const flag = runner.indexOf("process.env.XCHAIN_DOCS_TREE_NOTED = '1'");
        const spawn = runner.indexOf('spawnSync(process.execPath');
        expect(announce).toBeGreaterThan(-1);
        expect(flag).toBeGreaterThan(-1);
        // Order matters: flagged after the announcement, both before the loop.
        expect(announce).toBeLessThan(flag);
        expect(flag).toBeLessThan(spawn);
    });

    it('the notice never changes a verdict: a dirty tree still resolves ok', () => {
        const dir = makeGitDocsRoot({ dirty: true });
        try {
            // Advisory means advisory. If this ever exits non-zero, a shared
            // checkout's ordinary working state would fail every docs gate.
            const r = probe({ XCHAIN_DOCS_ROOT: dir });
            expect(r.status).toBe(0);
            expect(r.stdout).toBe('true');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('skipUnlessDocs no longer converts a declared-but-missing sibling into exit 0', () => {
        const dir = join(tmpdir(), `docs-sibling-absent-skip-${Date.now()}`);
        const script = `import { skipUnlessDocs } from ${JSON.stringify(HELPER)};`
            + "skipUnlessDocs('fixture-smoke');";
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            encoding: 'utf8',
            cwd: WS_ROOT,
            env: { ...process.env, XCHAIN_DOCS_ROOT: dir, XCHAIN_DOCS_OPTIONAL: '' },
        });
        expect(r.status).toBe(1);
        expect(r.stdout || '').not.toMatch(/^SKIP:/m);
    });
});
