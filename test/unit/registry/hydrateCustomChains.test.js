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

import { describe, it, expect, vi } from 'vitest';
import {
    ChainRegistry,
    BUNDLED_DESCRIPTORS,
    clearUserAddedChains,
    hydrateCustomChainsFromSettings,
    reconcileCustomChainsFromSettings,
} from '../../../packages/core/src/registry/index.js';
import { createCustomChainSync } from '../../../packages/core/src/registry/hydrateCustomChains.js';

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

describe('reconcileCustomChainsFromSettings', () => {
    const second = { ...btcRegtest, id: 'other-fork-regtest', displayName: 'Other' };
    const seeded = () => {
        const reg = new ChainRegistry();
        hydrateCustomChainsFromSettings(reg, { customChains: [custom, second] });
        return reg;
    };

    it('removes a user-added chain the record no longer lists and keeps the rest', () => {
        const reg = seeded();
        const r = reconcileCustomChainsFromSettings(reg, { customChains: [second] });
        expect(r).toEqual({ added: [], removed: ['my-fork-regtest'], replaced: [] });
        expect(reg.has('my-fork-regtest')).toBe(false);
        expect(reg.has('other-fork-regtest')).toBe(true);
    });

    it('installs a missing chain and swaps one whose descriptor changed', () => {
        const reg = seeded();
        const changed = { ...custom, displayName: 'Renamed' };
        const third = { ...btcRegtest, id: 'third-fork-regtest', displayName: 'Third' };
        const r = reconcileCustomChainsFromSettings(reg, { customChains: [changed, second, third] });
        expect(r).toEqual({ added: ['third-fork-regtest'], removed: [], replaced: ['my-fork-regtest'] });
        expect(reg.get('my-fork-regtest').displayName).toBe('Renamed');
        expect(reg.get('my-fork-regtest').isUserAdded).toBe(true);
    });

    it('treats an empty list as remove-all and an absent list as no change', () => {
        const reg = seeded();
        expect(reconcileCustomChainsFromSettings(reg, {})).toEqual({ added: [], removed: [], replaced: [] });
        expect(reconcileCustomChainsFromSettings(reg, null)).toEqual({ added: [], removed: [], replaced: [] });
        expect(reg.has('my-fork-regtest')).toBe(true);
        const r = reconcileCustomChainsFromSettings(reg, { customChains: [] });
        expect(r.removed.sort()).toEqual(['my-fork-regtest', 'other-fork-regtest']);
        expect(reg.get('bitcoin-regtest').isUserAdded).toBe(false);
    });

    it('never touches a bundled chain, even when a row collides with its id', () => {
        const reg = seeded();
        const before = reg.get('bitcoin-regtest');
        const r = reconcileCustomChainsFromSettings(reg, { customChains: [{ ...btcRegtest, displayName: 'Hijack' }] });
        expect(r.added).toEqual([]);
        expect(reg.get('bitcoin-regtest')).toBe(before);
    });

    it('wants the first row per id that boot would install, skipping invalid and reserved rows', () => {
        const reg = new ChainRegistry();
        const reserved = { ...btcRegtest, id: 'btcfork-mainnet', coin: 'Bitcoin', networkKind: 'mainnet' };
        const live = { ...btcRegtest, id: 'btcfork-mainnet', coin: 'btcfork', networkKind: 'mainnet' };
        const r = reconcileCustomChainsFromSettings(reg, { customChains: [{ id: 'broken' }, reserved, live, null] });
        expect(r.added).toEqual(['btcfork-mainnet']);
        expect(reg.get('btcfork-mainnet').coin).toBe('btcfork');
    });

    it('leaves an unchanged chain in place without notifying subscribers', () => {
        const reg = seeded();
        const version = reg.getVersion();
        reconcileCustomChainsFromSettings(reg, { customChains: [custom, second] });
        expect(reg.getVersion()).toBe(version);
    });
});

describe('clearUserAddedChains', () => {
    it('removes user-added chains, keeps bundled chains and tolerates incomplete registries', () => {
        const reg = new ChainRegistry();
        hydrateCustomChainsFromSettings(reg, { customChains: [custom] });

        expect(clearUserAddedChains(reg)).toEqual({ removed: ['my-fork-regtest'] });
        expect(reg.has('my-fork-regtest')).toBe(false);
        expect(reg.get('bitcoin-regtest').isUserAdded).toBe(false);
        expect(clearUserAddedChains({})).toEqual({ removed: [] });
        expect(clearUserAddedChains(null)).toEqual({ removed: [] });
    });
});

describe('createCustomChainSync', () => {
    it('reconciles, forwards the record and reports a drop only on removal or replacement', async () => {
        const reg = new ChainRegistry();
        const settings = { customChains: [custom] };
        const seen = [];
        const dropped = [];
        const sync = createCustomChainSync({
            registry: reg,
            getSettings: async () => settings,
            onSettings: (s) => seen.push(s),
            onChainsDropped: (r) => dropped.push(r),
        });
        await sync();
        expect(reg.has('my-fork-regtest')).toBe(true);
        expect(dropped).toEqual([]);
        settings.customChains = [];
        await sync();
        expect(reg.has('my-fork-regtest')).toBe(false);
        expect(dropped).toHaveLength(1);
        expect(seen).toHaveLength(2);
    });

    it('changes nothing when the read fails', async () => {
        const reg = new ChainRegistry();
        hydrateCustomChainsFromSettings(reg, { customChains: [custom] });
        const onSettings = vi.fn();
        const sync = createCustomChainSync({ registry: reg, getSettings: async () => { throw new Error('locked'); }, onSettings });
        expect(await sync()).toBeNull();
        expect(reg.has('my-fork-regtest')).toBe(true);
        expect(onSettings).not.toHaveBeenCalled();
    });

    it('lets the latest call win over a slower earlier read', async () => {
        const reg = new ChainRegistry();
        hydrateCustomChainsFromSettings(reg, { customChains: [custom] });
        let release;
        const slow = new Promise((resolve) => { release = resolve; });
        const reads = [() => slow, async () => ({ customChains: [] })];
        const sync = createCustomChainSync({ registry: reg, getSettings: () => reads.shift()() });
        const first = sync();
        await sync();
        expect(reg.has('my-fork-regtest')).toBe(false);
        release({ customChains: [custom] });
        expect(await first).toBeNull();
        expect(reg.has('my-fork-regtest')).toBe(false);
    });
});
