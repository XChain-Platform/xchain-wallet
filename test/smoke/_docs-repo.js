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
// The sibling is present in a full monorepo working tree and ABSENT from an
// isolated single-repo CI checkout, so every caller must skip LOUDLY rather
// than fail when it is missing: this guards documentation parity, not shipped
// product. Never silently pass.
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

/** Absolute path to a wallet doc, e.g. docsPath('privacy', 'privacy-policy.md'). */
export function docsPath(...parts) {
    return join(WALLET_DOCS, ...parts);
}

/** True when the sibling checkout is present and carries the wallet docs. */
export function docsAvailable() {
    return existsSync(WALLET_DOCS);
}

/** Read a wallet doc as UTF-8. Caller is expected to have skipped first. */
export function readDoc(...parts) {
    return readFileSync(docsPath(...parts), 'utf8');
}

/**
 * Skip the calling smoke, loudly, when the sibling checkout is absent.
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
