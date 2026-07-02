// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: CoSignerAccount read queries (§22, P4). Used by the bridge transport
// to resolve an inbound request's target account by aggregate address.

import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';
import {
    listCoSignerAccounts,
    findCoSignerAccountByAddress,
} from '../../../packages/core/src/flows/coSignerAccountQueries.js';

const MASTER_KEY = new Uint8Array(32).fill(7);

function mk(overrides = {}) {
    return createCoSignerAccount({
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        aggregateAddress: 'bcrt1pagg',
        agentPubkey: '02' + 'a'.repeat(64),
        daemonPubkey: '02' + 'b'.repeat(64),
        daemonDerivationPath: "m/86'/0'/0'/0/0",
        publicKeyOrder: ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)],
        policy: { allowedActions: ['SEND'] },
        ...overrides,
    });
}

describe('coSignerAccountQueries', () => {
    /** @type {Vault} */
    let vault;
    beforeEach(async () => {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey: MASTER_KEY });
        await vault.open();
    });

    it('lists a wallet accounts (and excludes other wallets)', async () => {
        await vault.coSignerAccounts.put(mk({ name: 'A' }));
        await vault.coSignerAccounts.put(mk({ name: 'B', aggregateAddress: 'bcrt1pother' }));
        await vault.coSignerAccounts.put(mk({ walletId: 'wallet-2', aggregateAddress: 'bcrt1pw2' }));
        const list = await listCoSignerAccounts(vault, 'wallet-1');
        expect(list).toHaveLength(2);
        expect(list.every((a) => a.walletId === 'wallet-1')).toBe(true);
    });

    it('resolves the enabled account owning an aggregate address on a chain', async () => {
        const acct = mk();
        await vault.coSignerAccounts.put(acct);
        const found = await findCoSignerAccountByAddress({ vault, chainId: 'bitcoin-regtest', aggregateAddress: 'bcrt1pagg' });
        expect(found.id).toBe(acct.id);
    });

    it('returns null for a disabled account or wrong chain', async () => {
        await vault.coSignerAccounts.put({ ...mk(), enabled: false });
        expect(await findCoSignerAccountByAddress({ vault, chainId: 'bitcoin-regtest', aggregateAddress: 'bcrt1pagg' })).toBeNull();
        await vault.coSignerAccounts.put(mk());
        expect(await findCoSignerAccountByAddress({ vault, chainId: 'bitcoin-mainnet', aggregateAddress: 'bcrt1pagg' })).toBeNull();
        expect(await findCoSignerAccountByAddress({ vault, chainId: 'bitcoin-regtest', aggregateAddress: 'nope' })).toBeNull();
    });

    it('validates required args', async () => {
        await expect(findCoSignerAccountByAddress({ vault, chainId: '', aggregateAddress: 'a' })).rejects.toThrow(/chainId/);
        await expect(findCoSignerAccountByAddress({ vault, chainId: 'c', aggregateAddress: '' })).rejects.toThrow(/aggregateAddress/);
        await expect(listCoSignerAccounts(vault, '')).rejects.toThrow(/walletId/);
    });
});
