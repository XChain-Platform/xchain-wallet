// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Cross-chain templates registry — §42.8.4. Bundled JSON templates
// describe pre-baked multi-action flows the user can launch into the
// Parallel composer (§42.8.2) with rows pre-filled.
//
// Templates are configuration, not code. Adding a new template means
// dropping a new `<id>.json` next to this file and adding it to the
// import list below. The shape is checked at load time by
// `validateCrossChainTemplate` so a malformed file fails loudly
// rather than rendering a broken composer.
//
// JSON imports use Vite's native handling — Vite turns the JSON into
// a JS object at build time. Node smokes don't load this file
// directly because Node 18 lacks JSON-module support without
// `--experimental-json-modules`; the smoke tests read the JSON
// files via `fs` and validate via the `validate.js` sibling, which
// is environment-agnostic.

import launchTokenWithMetadata from './launch-token-with-metadata.json';
import bridgeTokenPair from './bridge-token-pair.json';
import crossChainAirdrop from './cross-chain-airdrop.json';

import { validateCrossChainTemplate } from './validate.js';

/** @type {import('./validate.js').CrossChainTemplate[]} */
const RAW_TEMPLATES = [
    launchTokenWithMetadata,
    bridgeTokenPair,
    crossChainAirdrop,
];

/**
 * Validated, frozen list of bundled templates. Throws at module-load
 * time if any template is malformed — fail-fast keeps the wallet
 * from rendering a broken composer.
 *
 * @type {ReadonlyArray<import('./validate.js').CrossChainTemplate>}
 */
export const CROSS_CHAIN_TEMPLATES = (() => {
    const out = [];
    for (const t of RAW_TEMPLATES) {
        const res = validateCrossChainTemplate(t);
        if (!res.ok) {
            throw new Error(
                `cross-chain templates: invalid template "${t?.id || '(unknown)'}": ${res.errors.join('; ')}`,
            );
        }
        out.push(/** @type {import('./validate.js').CrossChainTemplate} */ (t));
    }
    return Object.freeze(out);
})();

/**
 * Look up a single template by id. Returns null when no template
 * matches — callers render an "unknown template" hint rather than
 * crashing.
 *
 * @param {string} id
 * @returns {import('./validate.js').CrossChainTemplate | null}
 */
export function templateById(id) {
    return CROSS_CHAIN_TEMPLATES.find((t) => t.id === id) || null;
}

export { validateCrossChainTemplate } from './validate.js';
