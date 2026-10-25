// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: one agent key and one wallet key make one aggregate address, so
// a second agent account for the same pair is refused. Two records would let
// the address resolve to whichever policy the lookup finds first, and
// disabling the account the owner sees would leave the other one signing.

import { describe, it, expect } from 'vitest';
import { provisionCoSignerAccount } from '../../packages/core/src/flows/provisionCoSignerAccount.js';
import { findCoSignerAccountByAddress } from '../../packages/core/src/flows/coSignerAccountQueries.js';
import { Vault } from '../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../packages/core/src/storage/backend.js';

const AGENT = '02' + 'a'.repeat(64);
const DAEMON = '02' + 'b'.repeat(64);
const sdk = {
    wallet: { getBitcoinNetwork: () => ({ bech32: 'bcrt' }) },
    coSigner: { deriveMuSig2P2TR: () => ({ address: 'bcrt1paggregateexample' }) },
};

async function openVault() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
    await vault.open();
    return vault;
}

const opts = (vault, policy) => ({
    vault,
    sdkRegistry: { get: () => sdk },
    walletId: 'wallet-1',
    chainId: 'bitcoin-regtest',
    agentPubkey: AGENT,
    daemonPubkey: DAEMON,
    daemonDerivationPath: "m/86'/0'/0'/0/3",
    policy,
});

describe('duplicate agent account for one key pair', () => {
    it('refuses a second account after the first', async () => {
        const vault = await openVault();
        await provisionCoSignerAccount(opts(vault, { allowedActions: ['SEND'] }));
        await expect(provisionCoSignerAccount(opts(vault, { allowedActions: ['SEND', 'ISSUE'] })))
            .rejects.toThrow(/already exists/);
        expect(await vault.coSignerAccounts.count()).toBe(1);
    });

    it('lets only one of two concurrent creates through', async () => {
        const vault = await openVault();
        const results = await Promise.allSettled([
            provisionCoSignerAccount(opts(vault, { allowedActions: ['SEND'] })),
            provisionCoSignerAccount(opts(vault, { allowedActions: ['SEND', 'ISSUE'] })),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const found = await findCoSignerAccountByAddress({
            vault, chainId: 'bitcoin-regtest', aggregateAddress: 'bcrt1paggregateexample',
        });
        expect(found).not.toBeNull();
        expect(await vault.coSignerAccounts.count()).toBe(1);
    });
});
