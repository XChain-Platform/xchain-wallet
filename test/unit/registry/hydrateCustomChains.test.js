// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-realm custom-chain hydration (§9.7 Developer Mode): a UI realm whose
// ChainRegistry is a separate instance from the host's installs the
// persisted descriptors from the settings record, skips what it already
// knows, and never throws on a bad row.

import { describe, it, expect } from 'vitest';
import {
    ChainRegistry,
    BUNDLED_DESCRIPTORS,
    hydrateCustomChainsFromSettings,
} from '../../../packages/core/src/registry/index.js';

const btcRegtest = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
const custom = { ...btcRegtest, id: 'my-fork-regtest', displayName: 'My Fork Regtest' };

describe('hydrateCustomChainsFromSettings', () => {
    it('installs a persisted custom chain the realm registry does not know', () => {
        const reg = new ChainRegistry();
        expect(reg.has('my-fork-regtest')).toBe(false);
        const r = hydrateCustomChainsFromSettings(reg, { customChains: [custom] });
        expect(r.added).toEqual(['my-fork-regtest']);
        expect(reg.has('my-fork-regtest')).toBe(true);
        expect(reg.get('my-fork-regtest').isUserAdded).toBe(true);
    });

    it('is idempotent: a second read adds nothing and does not throw on the duplicate', () => {
        const reg = new ChainRegistry();
        hydrateCustomChainsFromSettings(reg, { customChains: [custom] });
        const version = reg.getVersion();
        const r = hydrateCustomChainsFromSettings(reg, { customChains: [custom] });
        expect(r.added).toEqual([]);
        expect(reg.getVersion()).toBe(version);
    });

    it('never touches a bundled id and skips rows the validator rejects', () => {
        const reg = new ChainRegistry();
        const before = reg.supportedChains().length;
        const r = hydrateCustomChainsFromSettings(reg, {
            customChains: [
                null,
                'not-an-object',
                { id: 42 },
                { ...btcRegtest },
                { id: 'broken-chain' },
                custom,
            ],
        });
        expect(r.added).toEqual(['my-fork-regtest']);
        expect(reg.supportedChains().length).toBe(before + 1);
        expect(reg.get('bitcoin-regtest').isUserAdded).toBe(false);
        expect(reg.has('broken-chain')).toBe(false);
    });

    it('tolerates a missing record, a missing list and a missing registry', () => {
        const reg = new ChainRegistry();
        expect(hydrateCustomChainsFromSettings(reg, null)).toEqual({ added: [] });
        expect(hydrateCustomChainsFromSettings(reg, {})).toEqual({ added: [] });
        expect(hydrateCustomChainsFromSettings(reg, { customChains: 'nope' })).toEqual({ added: [] });
        expect(hydrateCustomChainsFromSettings(null, { customChains: [custom] })).toEqual({ added: [] });
    });
});
