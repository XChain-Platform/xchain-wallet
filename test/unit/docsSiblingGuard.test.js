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
// or fail. : it used to SKIP whenever the sibling checkout was absent,
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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
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
