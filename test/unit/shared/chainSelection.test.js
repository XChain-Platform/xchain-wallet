// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The one chain-default rule every action form shares. These pin the
// order the helper applies (explicit, then last-used while it still has
// addresses, then the first key) and the per-network scoping of the
// stored slot, so a form never opens on the wallet's oldest chain while
// the user is working on another.

import { describe, it, expect, vi } from 'vitest';
import {
    lastUsedChainIdFor,
    lastUsedChainPatch,
    pickDefaultChainId,
    recordLastUsedChain,
} from '../../../packages/core/src/shared/chainSelection.js';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const LTC = 'litecoin-mainnet';
// Creation order: Bitcoin first, Dogecoin later. Object key order is what
// the old default read.
const BY_CHAIN = { [BTC]: [{ id: 'b1' }], [DOGE]: [{ id: 'd1' }] };

describe('pickDefaultChainId', () => {
    it('opens on the last-used chain, not the first-created one', () => {
        const settings = { activeNetwork: 'mainnet', lastUsedChain: { mainnet: DOGE } };
        expect(pickDefaultChainId(BY_CHAIN, { settings })).toBe(DOGE);
    });

    it('an explicit chain wins over the last-used chain', () => {
        const settings = { activeNetwork: 'mainnet', lastUsedChain: { mainnet: DOGE } };
        expect(pickDefaultChainId(BY_CHAIN, { explicitChainId: BTC, settings })).toBe(BTC);
    });

    it('falls back to the first chain when the last-used one has no addresses left', () => {
        const settings = { activeNetwork: 'mainnet', lastUsedChain: { mainnet: LTC } };
        expect(pickDefaultChainId(BY_CHAIN, { settings })).toBe(BTC);
        const emptied = { ...BY_CHAIN, [LTC]: [] };
        expect(pickDefaultChainId(emptied, { settings })).toBe(BTC);
    });

    it('falls back to the first chain with no settings or no slot', () => {
        expect(pickDefaultChainId(BY_CHAIN)).toBe(BTC);
        expect(pickDefaultChainId(BY_CHAIN, { settings: null })).toBe(BTC);
        expect(pickDefaultChainId(BY_CHAIN, { settings: { lastUsedChain: {} } })).toBe(BTC);
    });

    it('reads only the active network slot, so a testnet choice never leaks into mainnet', () => {
        const settings = {
            activeNetwork: 'mainnet',
            lastUsedChain: { testnet: 'dogecoin-testnet', mainnet: DOGE },
        };
        expect(pickDefaultChainId(BY_CHAIN, { settings })).toBe(DOGE);
        const onlyTestnet = { activeNetwork: 'mainnet', lastUsedChain: { testnet: 'dogecoin-testnet' } };
        expect(pickDefaultChainId(BY_CHAIN, { settings: onlyTestnet })).toBe(BTC);
    });

    it('returns null when the wallet has no addresses on any chain', () => {
        expect(pickDefaultChainId({})).toBeNull();
        expect(pickDefaultChainId(null)).toBeNull();
        // An explicit chain still wins there; the caller decides what an
        // explicit chain without addresses means.
        expect(pickDefaultChainId({}, { explicitChainId: BTC })).toBe(BTC);
    });
});

describe('lastUsedChainIdFor', () => {
    it('defaults the network to mainnet when the record carries none', () => {
        expect(lastUsedChainIdFor({ lastUsedChain: { mainnet: BTC } })).toBe(BTC);
        expect(lastUsedChainIdFor({ lastUsedChain: { testnet: 'bitcoin-testnet' } })).toBeNull();
    });

    it('ignores a slot that is not a non-empty string', () => {
        expect(lastUsedChainIdFor({ lastUsedChain: { mainnet: '' } })).toBeNull();
        expect(lastUsedChainIdFor({ lastUsedChain: { mainnet: 7 } })).toBeNull();
        expect(lastUsedChainIdFor(null)).toBeNull();
    });
});

describe('lastUsedChainPatch', () => {
    it('keys the slot by the chain\'s own network', () => {
        expect(lastUsedChainPatch(DOGE)).toEqual({ lastUsedChain: { mainnet: DOGE } });
        expect(lastUsedChainPatch('dogecoin-testnet')).toEqual({ lastUsedChain: { testnet: 'dogecoin-testnet' } });
        expect(lastUsedChainPatch('litecoin-regtest')).toEqual({ lastUsedChain: { regtest: 'litecoin-regtest' } });
    });

    it('yields nothing for a chain the registry does not know, or no chain', () => {
        expect(lastUsedChainPatch('nochain-mainnet')).toBeNull();
        expect(lastUsedChainPatch(null)).toBeNull();
        expect(lastUsedChainPatch('')).toBeNull();
    });
});

describe('recordLastUsedChain', () => {
    it('writes the patch through messaging.updateSettings', async () => {
        const updateSettings = vi.fn().mockResolvedValue({});
        await recordLastUsedChain({ updateSettings }, LTC);
        expect(updateSettings).toHaveBeenCalledWith({ lastUsedChain: { mainnet: LTC } });
    });

    it('never rejects: a failed write, an unknown chain and a host without the method are all silent', async () => {
        await expect(recordLastUsedChain({ updateSettings: vi.fn().mockRejectedValue(new Error('locked')) }, LTC))
            .resolves.toBeUndefined();
        const updateSettings = vi.fn();
        await recordLastUsedChain({ updateSettings }, 'nochain-mainnet');
        expect(updateSettings).not.toHaveBeenCalled();
        await expect(recordLastUsedChain({}, LTC)).resolves.toBeUndefined();
        await expect(recordLastUsedChain(null, LTC)).resolves.toBeUndefined();
    });
});
