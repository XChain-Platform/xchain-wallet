// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The last-used chain slots live in Settings, which the vault stores
// SPARSE and patches by deep merge. These pin the two properties the
// action forms depend on: a slot written for one network survives a
// later write for another (the patch merges, it does not replace), and
// the slots survive the deflate / inflate roundtrip of the vault store.

import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { getSettings, updateSettings } from '../../../packages/core/src/flows/settings.js';
import { lastUsedChainPatch, lastUsedChainIdFor } from '../../../packages/core/src/shared/chainSelection.js';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';

const crypto = globalThis.crypto ?? webcrypto;

async function makeVault() {
    const masterKey = new Uint8Array(32);
    crypto.getRandomValues(masterKey);
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey });
    await vault.open();
    return vault;
}

describe('lastUsedChain persistence', () => {
    it('one slot per network, each written by its own patch, both readable back', async () => {
        const vault = await makeVault();
        await updateSettings(vault, lastUsedChainPatch('dogecoin-mainnet'));
        await updateSettings(vault, lastUsedChainPatch('litecoin-testnet'));
        const s = await getSettings(vault);
        expect(s.lastUsedChain).toEqual({ mainnet: 'dogecoin-mainnet', testnet: 'litecoin-testnet' });
    });

    it('a later write on the same network replaces only that slot', async () => {
        const vault = await makeVault();
        await updateSettings(vault, lastUsedChainPatch('dogecoin-mainnet'));
        await updateSettings(vault, lastUsedChainPatch('bitcoin-testnet'));
        await updateSettings(vault, lastUsedChainPatch('litecoin-mainnet'));
        const s = await getSettings(vault);
        expect(s.lastUsedChain).toEqual({ mainnet: 'litecoin-mainnet', testnet: 'bitcoin-testnet' });
    });

    it('the reader follows the active network, not the most recent write', async () => {
        const vault = await makeVault();
        await updateSettings(vault, lastUsedChainPatch('dogecoin-mainnet'));
        await updateSettings(vault, lastUsedChainPatch('litecoin-testnet'));
        expect(lastUsedChainIdFor(await getSettings(vault))).toBe('dogecoin-mainnet');
        await updateSettings(vault, { activeNetwork: 'testnet' });
        expect(lastUsedChainIdFor(await getSettings(vault))).toBe('litecoin-testnet');
        await updateSettings(vault, { activeNetwork: 'regtest' });
        expect(lastUsedChainIdFor(await getSettings(vault))).toBeNull();
    });
});
