// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Sign message names a wallet and an address record. The signer comes from the
// wallet and the derivation path from the record, so an HD record of another
// wallet signs with this wallet's key at that path: a signature from an address
// the review never showed. The route refuses a record whose account is not in
// the named wallet.

import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const CHAIN_ID = 'bitcoin-regtest';

function makeHost() {
    const records = {
        'addr-a': {
            id: 'addr-a', accountId: 'account-a', chain: 'bitcoin', network: 'regtest',
            source: 'hd', derivationPath: "m/84'/1'/0'/0/0", address: 'bcrt1qwalletaaddress',
        },
        'addr-b': {
            id: 'addr-b', accountId: 'account-b', chain: 'bitcoin', network: 'regtest',
            source: 'hd', derivationPath: "m/84'/1'/0'/0/7", address: 'bcrt1qwalletbaddress',
        },
        'addr-orphan': {
            id: 'addr-orphan', accountId: 'account-gone', chain: 'bitcoin', network: 'regtest',
            source: 'hd', derivationPath: "m/84'/1'/0'/0/3", address: 'bcrt1qorphanaddress',
        },
    };
    const accounts = {
        'account-a': { id: 'account-a', walletId: 'wallet-a' },
        'account-b': { id: 'account-b', walletId: 'wallet-b' },
    };
    const signMessage = vi.fn(async () => ({ signature: 'fixed-signature' }));
    const host = createBackgroundHost({
        vault: {
            addresses: { get: async (id) => records[id] || null },
            accounts: { get: async (id) => accounts[id] || null },
        },
        chainRegistry: {
            chainIdFor: (chain, network) => (chain === 'bitcoin' && network === 'regtest' ? CHAIN_ID : undefined),
        },
        sdkRegistry: { get: () => undefined, for: () => ({}) },
        signerPool: { get: () => ({ signMessage }), has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, signMessage };
}

const sign = (host, request) => host.handle({ type: 'auth.signMessage', request });

describe('auth.signMessage signs only addresses of the named wallet', () => {
    it("refuses another wallet's HD address and signs nothing", async () => {
        const { host, signMessage } = makeHost();
        const response = await sign(host, { walletId: 'wallet-a', addressId: 'addr-b', message: 'hello' });
        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/not in this wallet/);
        expect(signMessage).not.toHaveBeenCalled();
    });

    it('refuses an HD address whose account no longer exists', async () => {
        const { host, signMessage } = makeHost();
        const response = await sign(host, { walletId: 'wallet-a', addressId: 'addr-orphan', message: 'hello' });
        expect(response.ok).toBe(false);
        expect(signMessage).not.toHaveBeenCalled();
    });

    it("signs the wallet's own HD address with its path", async () => {
        const { host, signMessage } = makeHost();
        const response = await sign(host, { walletId: 'wallet-a', addressId: 'addr-a', message: 'hello' });
        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(signMessage).toHaveBeenCalledWith(expect.objectContaining({ path: "m/84'/1'/0'/0/0" }));
    });
});
