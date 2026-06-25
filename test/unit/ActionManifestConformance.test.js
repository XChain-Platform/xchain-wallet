// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cross-repo ACTION-manifest conformance guard. The wallet registry is the
// authorable action set (which actions get a form). The authoritative cross-repo
// set lives in xchain-documentation/protocol/action-manifest.json (vendored
// here). This guard asserts the wallet registry equals the manifest's walletForm
// slice, so adding an action everywhere-but-the-wallet (or vice versa) fails loud.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { COMMON_ACTIONS, BTC_EXCLUSIVE_ACTIONS } from '../../packages/core/src/registry/actions.js';
import MANIFEST from '../fixtures/action-manifest.json';

// vitest anchors its root to the wallet repo, so cwd is the repo root.
const VENDORED = join(process.cwd(), 'test', 'fixtures', 'action-manifest.json');

function manifestSlice(flag) {
    return Object.entries(MANIFEST.actions).filter(([, v]) => v[flag]).map(([k]) => k).sort();
}
function localWalletSet() {
    return [...new Set([...COMMON_ACTIONS, ...BTC_EXCLUSIVE_ACTIONS])].sort();
}

describe('ACTION manifest conformance: wallet walletForm set @regression', () => {
    it('the registry exactly equals the manifest walletForm slice', () => {
        const expected = manifestSlice('walletForm');
        const actual   = localWalletSet();
        const missing = expected.filter(a => !actual.includes(a)); // manifest says form, wallet forgot
        const extra   = actual.filter(a => !expected.includes(a));  // wallet form, manifest unaware
        expect({ missing, extra },
            'wallet registry/actions.js drifted from action-manifest.json walletForm set. ' +
            'Edit xchain-documentation/protocol/action-manifest.json + re-vendor, or update the registry.'
        ).toEqual({ missing: [], extra: [] });
    });

    // IDENTITY: vendored copy must match canonical (skip when sibling absent).
    it('vendored test/fixtures/action-manifest.json is byte-identical to canonical', (ctx) => {
        const DOCS = process.env.XCHAIN_DOCS_DIR
            ? join(process.env.XCHAIN_DOCS_DIR, 'protocol', 'action-manifest.json')
            : join(process.cwd(), '..', 'xchain-documentation', 'protocol', 'action-manifest.json');
        if (!existsSync(DOCS)) { ctx.skip(); return; }
        expect(readFileSync(VENDORED, 'utf8'),
            'vendored action-manifest.json drifted from canonical; edit ' +
            'xchain-documentation/protocol/action-manifest.json and re-vendor all copies.'
        ).toEqual(readFileSync(DOCS, 'utf8'));
    });
});
