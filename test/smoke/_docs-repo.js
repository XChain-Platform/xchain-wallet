// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Locates the wallet's prose documentation, which  moved OUT of this
// repo and into the sibling `xchain-documentation` checkout, published at
// https://docs.xchain.io/components/wallet/.
//
// Several smokes assert on the CONTENT of those docs (a store form must
// answer what the policy says, an error-code table must list what the code
// emits). Those assertions are worth keeping, so they follow the docs across
// the repo boundary rather than being deleted.
//
// DECLARED-AND-MISSING IS A FAILURE, NOT A SKIP .
//
// This used to skip whenever the sibling was absent, on the reasoning that an
// isolated single-repo checkout legitimately has no siblings. That made the
// skip indistinguishable from a broken gate. The CI dispatcher resolved
// siblings from the PUSHING worktree, so a push from a linked git worktree
// shipped the wrong repository into the xchain-documentation slot; the slot
// then held no wallet docs, every smoke here took its documented skip, and the
// gate reported GREEN having exercised none of them (measured 2026-08-03).
//
// So the rule follows the declaration instead of the filesystem: when
// .ci-siblings names xchain-documentation, the sibling is a gate dependency
// and its absence is a red, exactly as a missing coverage floor is. The
// dispatcher now refuses to run at all when a declared sibling is unresolvable,
// so under the gate these two guards agree.
//
// Escape hatches, both deliberate and both loud:
//   XCHAIN_DOCS_ROOT=<path>      the sibling lives somewhere else
//   XCHAIN_DOCS_OPTIONAL=1       a genuinely isolated checkout; skip as before
//
// Not a `*.smoke.js` file, so the runner does not try to execute it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));          // test/smoke
const wsRoot = join(here, '..', '..');                          // xchain-wallet

// Resolved from this file's own location, never cwd, so a smoke run from
// anywhere finds the same checkout. XCHAIN_DOCS_ROOT overrides it when the
// sibling lives somewhere other than beside this repo.
export const DOCS_ROOT = process.env.XCHAIN_DOCS_ROOT
    || join(wsRoot, '..', 'xchain-documentation');

export const WALLET_DOCS = join(DOCS_ROOT, 'components', 'wallet');

const SIBLINGS_FILE = join(wsRoot, '.ci-siblings');

/**
 * Does this repo DECLARE the docs sibling as a CI dependency? Declared means
 * the harness is contracted to ship it, so absence is a harness failure rather
 * than a checkout that never had it.
 */
export function docsDeclared() {
    try {
        return readFileSync(SIBLINGS_FILE, 'utf8')
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'))
            .includes('xchain-documentation');
    } catch {
        return false;                    // no .ci-siblings: nothing was promised
    }
}

/**
 * Verdict on the sibling, without acting on it. Exported for the unit test that
 * pins these rules; smokes call docsAvailable().
 *
 * 'ok'      -> the wallet docs are there
 * 'skip'    -> absent and not declared (or opted out): the old behaviour
 * 'refuse'  -> declared but unresolvable: the silent hole, now a red
 */
export function docsVerdict() {
    if (existsSync(WALLET_DOCS)) return { status: 'ok', reason: '' };
    if (process.env.XCHAIN_DOCS_OPTIONAL === '1') {
        return { status: 'skip', reason: 'XCHAIN_DOCS_OPTIONAL=1' };
    }
    if (!docsDeclared()) {
        return { status: 'skip', reason: `${SIBLINGS_FILE} does not declare xchain-documentation` };
    }
    // Name what IS in the slot: "the wrong repo is mounted here" and "nothing is
    // mounted here" need different fixes, and the wrong-repo case is the one
    // that produced a green gate.
    let occupant = 'nothing is there';
    if (existsSync(DOCS_ROOT)) {
        let name = '';
        try {
            name = JSON.parse(readFileSync(join(DOCS_ROOT, 'package.json'), 'utf8')).name || '';
        } catch { /* not every checkout has one */ }
        occupant = name
            ? `the slot holds a checkout of '${name}', which has no components/wallet`
            : 'the slot exists but has no components/wallet';
    }
    return {
        status: 'refuse',
        reason: `${WALLET_DOCS} is not readable: ${occupant}`,
    };
}

/** Absolute path to a wallet doc, e.g. docsPath('privacy', 'privacy-policy.md'). */
export function docsPath(...parts) {
    return join(WALLET_DOCS, ...parts);
}

/**
 * True when the sibling checkout is present and carries the wallet docs.
 *
 * When the sibling is DECLARED and still unreachable this does not return at
 * all: it exits 1. Every caller here is shaped `if (docsAvailable())` or
 * `if (!docsAvailable())`, so refusing inside the predicate is what makes the
 * whole family fail loud without 51 call sites having to remember to.
 */
export function docsAvailable() {
    const v = docsVerdict();
    if (v.status === 'ok') return true;
    if (v.status === 'skip') return false;
    console.error(`FAIL: the wallet docs sibling is DECLARED in .ci-siblings but unreachable.\n`
        + `  ${v.reason}\n`
        + '   moved the wallet docs to the sibling xchain-documentation repo, and this\n'
        + '  repo declares it in .ci-siblings, so the CI harness is contracted to ship it.\n'
        + '  Skipping here would report GREEN on documentation parity that nothing checked\n'
        + '  (: a push from a linked worktree shipped the WRONG repo into this slot).\n'
        + '  Fix the checkout: clone xchain-documentation beside this repo, or set\n'
        + '  XCHAIN_DOCS_ROOT. To accept an unverified docs surface, set XCHAIN_DOCS_OPTIONAL=1.');
    process.exit(1);
}

/** Read a wallet doc as UTF-8. Caller is expected to have skipped first. */
export function readDoc(...parts) {
    return readFileSync(docsPath(...parts), 'utf8');
}

/**
 * Skip the calling smoke, loudly, when the sibling checkout is absent AND not
 * declared. When it IS declared, docsAvailable() has already exited 1 and this
 * never reaches the skip: a promised sibling that is missing is a red.
 * Exits 0 (a skip, not a pass) after saying which smoke went unrun and why.
 */
export function skipUnlessDocs(smokeName) {
    if (docsAvailable()) return;
    console.log(`SKIP: ${smokeName} - the wallet docs are not in this checkout. `
        + ' moved them to the sibling xchain-documentation repo '
        + `(expected at ${WALLET_DOCS}); clone it beside this one, or set `
        + 'XCHAIN_DOCS_ROOT, to run this gate.');
    process.exit(0);
}
