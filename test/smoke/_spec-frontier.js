// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Reads the BUILD-SPEC:FRONTIER blocks that the platform's specs carry, and
// resolves the file paths their rows cite.
//
// WHY THIS IS SHARED RATHER THAN LOCAL TO ONE GATE (): the frontier
// table is what a later stage, or the operator, reads to learn what is left,
// so a row naming an artifact that no longer exists quietly costs a stage. It
// cost  two.  closed its own instance in §6 of
// extension-ceremony-collateral.smoke.js, and the same rot was then measured
// in the sibling publishing specs, which nothing checked at all. One parser
// serves every spec so the rule cannot drift between them.
//
// Not a `*.smoke.js` file, so the runner does not try to execute it.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));           // test/smoke
export const WALLET_ROOT = join(here, '..', '..');              // xchain-wallet

// The monorepo of sibling checkouts. Resolved from this file's own location,
// never cwd, so a smoke run from anywhere finds the same tree. Absent from an
// isolated single-repo CI checkout, which is why callers must skip loudly.
export const PLATFORM_ROOT = process.env.XCHAIN_PLATFORM_ROOT
    || join(WALLET_ROOT, '..');

export const SPECS_DIR = join(PLATFORM_ROOT, 'claude', 'specs');

/** True when the platform checkout is present and carries the specs. */
export function specsAvailable() {
    return existsSync(SPECS_DIR);
}

/** Skip the calling smoke, loudly, when the platform checkout is absent. */
export function skipUnlessSpecs(smokeName) {
    if (specsAvailable()) return;
    console.log(`SKIP: ${smokeName} - the platform specs are not in this checkout. `
        + `They live in the XChain-Platform superrepo (expected at ${SPECS_DIR}); `
        + 'clone it around this one, or set XCHAIN_PLATFORM_ROOT, to run this gate.');
    process.exit(0);
}

/** Every `claude/specs/*.md`, as { name, path, text }. */
export function listSpecs() {
    return readdirSync(SPECS_DIR)
        .filter((n) => n.endsWith('.md'))
        .sort()
        .map((name) => {
            const path = join(SPECS_DIR, name);
            return { name, path, text: readFileSync(path, 'utf8') };
        });
}

// A cited path, and only ever inside backticks. The backtick is the whole
// convention: code font means "go and open this", plain prose means the text
// is narrating something (very often something deleted, which these specs do
// on purpose in their superseded rows). Holding prose to the pointer's rule
// would fire on correct writing, and a check that fires on correct writing is
// one people delete.
//
// The prefixes are the ones the specs actually use: the four in-repo trees
// 's §6 already matched, plus `claude/` (platform-owned) and any
// `xchain-*/` sibling checkout, which is how a spec names a page that the
//  migration moved into xchain-documentation.
export const CITED = new RegExp(
    '`((?:packages|tools|test|\\.github|claude|xchain-[a-z0-9-]+)/[A-Za-z0-9_./-]+)`', 'g');

// Not every backticked path is a path. Three shapes are deliberately not one:
// a version placeholder (`vX.Y.Z`), a token the reader substitutes (`<id>`, a
// glob), and an ELIDED path (`xchain-documentation/.../android-play.md`), the
// specs' shorthand for a home too long to sit inside a table cell. Elisions
// are counted and reported rather than silently dropped, because a citation
// that cannot be resolved is also a citation that cannot rot loudly.
const PLACEHOLDER = /vX\.Y\.Z|<|\*|\/\.\.\.\//;

/**
 * Citations on one line of markdown.
 * @returns {{ paths: string[], placeholders: string[] }}
 */
export function citationsIn(line) {
    const all = [...line.matchAll(CITED)].map((m) => m[1]);
    return {
        paths: all.filter((p) => !PLACEHOLDER.test(p)),
        placeholders: all.filter((p) => PLACEHOLDER.test(p)),
    };
}

// THE TRAP THIS RESOLVER EXISTS FOR, and it has now been paid for twice.
//
// A `packages/`, `tools/` or `test/` path is NOT necessarily the wallet
// repo's. The release story spans sibling checkouts: test/wallet-privacy-
// policy-sync.test.js lives in xchain-websites, not here. Resolving every
// citation against one tree reports LIVE files as dead, and the
// sweep that found this defect in the sibling specs made exactly that mistake
// on three of its five hits before it caught itself.
//
// So a citation resolves if it resolves in ANY checkout in the monorepo, and
// the checkout that owned it is reported, both for the operator and so a
// citation resolving somewhere absurd is visible rather than silently green.
function checkouts() {
    const roots = [WALLET_ROOT, PLATFORM_ROOT];
    for (const name of readdirSync(PLATFORM_ROOT).sort()) {
        const full = join(PLATFORM_ROOT, name);
        if (full !== WALLET_ROOT && existsSync(join(full, '.git'))) roots.push(full);
    }
    return roots;
}

const ROOTS = specsAvailable() ? checkouts() : [WALLET_ROOT];

// THE SECOND TRAP, found while porting the gate: a working tree is not the
// repo. This monorepo is worked by more than one session through shared
// checkouts, so a sibling is routinely BEHIND its own origin - the wallet
// checkout was 16 commits behind when this was written, and two paths cited
// by a landed frontier row were therefore missing from disk while being alive
// on origin/master. Failing on those would make the gate red for a reason no
// spec edit can fix, which is how a gate gets deleted.
//
// So a miss on disk falls back to the committed tips, and ONLY the tips: not
// history. A file that  moved out is absent from every tip, which is
// exactly the rot being guarded; a file that merely has not been pulled yet
// is present in one.
const TIPS = ['HEAD', 'origin/HEAD', 'origin/master', 'origin/main'];

function inGitTip(root, path) {
    const p = path.replace(/\/+$/, '');
    for (const ref of TIPS) {
        const r = spawnSync('git', ['-C', root, 'cat-file', '-e', `${ref}:${p}`], {
            stdio: 'ignore',
        });
        if (r.status === 0) return ref;
    }
    return null;
}

/**
 * Resolve one cited path against every checkout.
 * @returns {{ ok: boolean, where: string|null, ref?: string }} where names the
 *          checkout that owns it; ref is set only when the path was found in a
 *          committed tip rather than on disk.
 */
export function resolveCitation(path) {
    // `claude/...` and `xchain-<repo>/...` are platform-root-relative by
    // construction, so they are resolved there and ONLY there. Every sibling
    // checkout has a claude/ directory of its own, and letting one of those
    // answer for `claude/reports/` would attribute a platform path to a repo
    // that merely happens to have a same-named folder - a green with the wrong
    // reason, which is worse than a red.
    const roots = /^(claude|xchain-[a-z0-9-]+)\//.test(path) ? [PLATFORM_ROOT] : ROOTS;

    for (const root of roots) {
        if (existsSync(join(root, path))) return { ok: true, where: root };
    }
    for (const root of roots) {
        if (!existsSync(join(root, '.git'))) continue;
        const ref = inGitTip(root, path);
        if (ref) return { ok: true, where: root, ref };
    }
    return { ok: false, where: null };
}

/**
 * The LIVE rows of a spec's frontier block.
 *
 * Live means the row still tells somebody to go and do something. A struck
 * Item cell (~~...~~, this spec family's mark for a closed row) or a
 * parenthesised superseded copy is history and is deliberately allowed to
 * name dead files: that is the record. Everything else is held to naming
 * things that exist, INCLUDING rows marked DONE, because a DONE row is still
 * the account a later stage reads.
 *
 * @returns {{ found: boolean, rows: Array<{id,item,state,line}> }}
 */
export function frontierRowsOf(text) {
    const open = text.indexOf('<!-- BUILD-SPEC:FRONTIER');
    const close = text.indexOf('<!-- /BUILD-SPEC:FRONTIER', open + 1);
    if (open === -1 || close < open) return { found: false, rows: [] };

    const rows = [];
    for (const line of text.slice(open, close).split('\n')) {
        if (!line.startsWith('|')) continue;
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        if (cells.length < 5) continue;
        const [id, item, , state] = cells;
        if (!/^\d/.test(id)) continue;                                 // header and separator
        if (item.startsWith('~~') || item.startsWith('(')) continue;    // closed / superseded
        if (/^\**note\b/i.test(state)) continue;                        // annotation, not a row
        rows.push({ id, item, state, line });
    }
    return { found: true, rows };
}
