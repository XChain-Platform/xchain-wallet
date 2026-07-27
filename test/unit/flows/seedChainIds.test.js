// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// : a wallet added while the app sits on a regtest network was
// inert. New wallets/accounts derive one address per `activeChainIds`,
// and every shell defaults that to the three MAINNETS, which the
// active-network filter then hides: Home, Receive and Addresses all
// said "no addresses", and Add-address offered no coin because its
// list came from the chains the account already occupied. Nothing
// in the app could break the tie - regtest activation only covers
// accounts that already exist and cannot be re-run.

import { describe, it, expect } from 'vitest';
import {
    activeChainIdsFromSettings,
    resolveSeedChainIds,
    seedChainIdsForVault,
} from '../../../packages/core/src/flows/seedChainIds.js';

const DESCRIPTORS = [
    { id: 'bitcoin-mainnet', networkKind: 'mainnet' },
    { id: 'litecoin-mainnet', networkKind: 'mainnet' },
    { id: 'dogecoin-mainnet', networkKind: 'mainnet' },
    { id: 'bitcoin-testnet', networkKind: 'testnet' },
    { id: 'bitcoin-regtest', networkKind: 'regtest' },
    { id: 'litecoin-regtest', networkKind: 'regtest' },
    { id: 'dogecoin-regtest', networkKind: 'regtest' },
];

const chainRegistry = {
    has: (id) => DESCRIPTORS.some((d) => d.id === id),
    get: (id) => DESCRIPTORS.find((d) => d.id === id) || undefined,
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    byNetworkKind: (kind) => DESCRIPTORS.filter((d) => d.networkKind === kind),
};

const MAINNETS = ['bitcoin-mainnet', 'dogecoin-mainnet', 'litecoin-mainnet'];

/** Settings shaped like the real record: one `fees` entry per activated chain. */
function settingsFor(chainIds, activeNetwork) {
    return {
        activeNetwork,
        fees: Object.fromEntries(chainIds.map((id) => [id, { strategy: 'normal' }])),
    };
}

describe(': activeChainIdsFromSettings', () => {
    it('returns the configured chains on the active network', () => {
        const settings = settingsFor([...MAINNETS, 'bitcoin-regtest', 'litecoin-regtest'], 'regtest');
        expect(activeChainIdsFromSettings(settings, chainRegistry))
            .toEqual(['bitcoin-regtest', 'litecoin-regtest']);
    });

    it('falls back to the registry when the active network has no configured chain', () => {
        // The user flipped to testnet without any testnet chain seeded yet.
        // Handing back an empty set here is what left the wallet inert.
        const settings = settingsFor(MAINNETS, 'testnet');
        expect(activeChainIdsFromSettings(settings, chainRegistry)).toEqual(['bitcoin-testnet']);
    });

    it('treats a missing activeNetwork as mainnet', () => {
        expect(activeChainIdsFromSettings({ fees: {} }, chainRegistry))
            .toEqual(['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet']);
    });

    it('ignores fee entries for chains the registry does not know', () => {
        const settings = { activeNetwork: 'regtest', fees: { 'bitcoin-regtest': {}, 'ghost-chain': {} } };
        expect(activeChainIdsFromSettings(settings, chainRegistry)).toEqual(['bitcoin-regtest']);
    });
});

describe(': resolveSeedChainIds', () => {
    it('seeds the ACTIVE network first, then the other configured chains', () => {
        // The repro: regtest activated, app on regtest, user adds a wallet.
        // The new wallet must land on the regtest chains, and keeps the
        // mainnet ones so switching back is not a second dead end.
        const settings = settingsFor([...MAINNETS, 'bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest'], 'regtest');
        const ids = resolveSeedChainIds({ settings, chainRegistry, fallback: MAINNETS });

        expect(ids.slice(0, 3)).toEqual(['bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest']);
        expect([...ids].sort()).toEqual([
            'bitcoin-mainnet', 'bitcoin-regtest',
            'dogecoin-mainnet', 'dogecoin-regtest',
            'litecoin-mainnet', 'litecoin-regtest',
        ]);
    });

    it('bites testnet too, not just regtest: a testnet vault seeds testnet', () => {
        // The ledger open question. Nothing about the gap is regtest-specific;
        // it is "active network != mainnet".
        const settings = settingsFor([...MAINNETS, 'bitcoin-testnet'], 'testnet');
        const ids = resolveSeedChainIds({ settings, chainRegistry, fallback: MAINNETS });
        expect(ids[0]).toBe('bitcoin-testnet');
    });

    it('is a no-op on mainnet: the same three chains as before', () => {
        const settings = settingsFor(MAINNETS, 'mainnet');
        const ids = resolveSeedChainIds({ settings, chainRegistry, fallback: MAINNETS });
        expect([...ids].sort()).toEqual([...MAINNETS].sort());
    });

    it('lets an explicit request win untouched', () => {
        const settings = settingsFor(MAINNETS, 'mainnet');
        expect(resolveSeedChainIds({
            requested: ['bitcoin-regtest'], settings, chainRegistry, fallback: MAINNETS,
        })).toEqual(['bitcoin-regtest']);
    });

    it('falls back when there is no settings record at all', () => {
        expect(resolveSeedChainIds({ settings: null, chainRegistry: null, fallback: MAINNETS }))
            .toEqual(MAINNETS);
    });
});

describe(': seedChainIdsForVault', () => {
    it('reads the vault settings', async () => {
        const vault = {
            settings: { get: async () => settingsFor([...MAINNETS, 'bitcoin-regtest'], 'regtest') },
        };
        const ids = await seedChainIdsForVault({ vault, chainRegistry, fallback: MAINNETS });
        expect(ids[0]).toBe('bitcoin-regtest');
    });

    it('degrades to the fallback when the settings read throws', async () => {
        // A locked or half-provisioned vault must not fail the wallet add.
        const vault = { settings: { get: async () => { throw new Error('locked'); } } };
        const ids = await seedChainIdsForVault({ vault, chainRegistry, fallback: MAINNETS });
        expect([...ids].sort()).toEqual([...MAINNETS].sort());
    });

    it('never reads the vault when the caller supplied chains', async () => {
        let reads = 0;
        const vault = { settings: { get: async () => { reads += 1; return null; } } };
        const ids = await seedChainIdsForVault({
            vault, chainRegistry, requested: ['litecoin-mainnet'], fallback: MAINNETS,
        });
        expect(ids).toEqual(['litecoin-mainnet']);
        expect(reads).toBe(0);
    });
});
