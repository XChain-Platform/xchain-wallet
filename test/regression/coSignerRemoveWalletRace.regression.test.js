// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: removing a wallet must not leave one of its agent accounts
// behind. A window write that read the account before the delete was saved
// would put the whole old record back, and an account added while the
// removal runs would outlive its wallet.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../packages/core/src/flows/gatedContent.js', () => ({
    clearGatedContentCaches: vi.fn(),
}));

vi.mock('../../packages/core/src/flows/gatedPublishAction.js', () => ({
    clearPendingGeneratedKeysForWallet: vi.fn(),
}));

import { removeWallet } from '../../packages/core/src/flows/removeWallet.js';
import { createVaultWindowPersistence } from '../../packages/core/src/cosigner/vaultWindowPersistence.js';
import { withAccountLock } from '../../packages/core/src/cosigner/accountLock.js';
import { createCoSignerAccount } from '../../packages/core/src/schemas/coSignerAccount.js';
import { Vault } from '../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../packages/core/src/storage/backend.js';

const AGENT = '02' + 'a'.repeat(64);
const DAEMON = '02' + 'b'.repeat(64);
const WINDOW = { version: 1, entries: [{ t: 1000, action: 'SEND', tick: 'XCHAIN', amount: '5', txid: null }], lastSeen: 1000 };

// Hold every save until release() so a queued delete stays unsaved.
class GatedBackend extends InMemoryBackend {
    constructor() {
        super();
        this.gate = Promise.resolve();
        this.release = () => {};
    }

    close() {
        this.gate = new Promise((resolve) => { this.release = resolve; });
    }

    async save(blob, options) {
        await this.gate;
        return super.save(blob, options);
    }
}

function agentAccount(walletId, aggregateAddress) {
    return createCoSignerAccount({
        walletId,
        chainId: 'bitcoin-regtest',
        aggregateAddress,
        agentPubkey: AGENT,
        daemonPubkey: DAEMON,
        daemonDerivationPath: "m/86'/0'/0'/0/3",
        publicKeyOrder: [AGENT, DAEMON],
        policy: { allowedActions: ['SEND'], maxPerWindow: { hours: 24, maxActions: 1 } },
    });
}

function emptyCollection() {
    return {
        list: async () => [],
        findBy: async () => [],
        put: async () => {},
        delete: async () => false,
    };
}

// Real agent-account storage beside empty stand-ins for the other collections.
function removalVault(vault, overrides = {}) {
    const wallet = { id: 'wallet-1', importedKeys: [] };
    return {
        wallets: { get: async (id) => (id === wallet.id ? wallet : null), delete: async () => true },
        accounts: emptyCollection(),
        addresses: emptyCollection(),
        connectedSites: emptyCollection(),
        pendingTxs: emptyCollection(),
        pendingAirdrops: emptyCollection(),
        pendingDeploys: emptyCollection(),
        multisigSigningSessions: emptyCollection(),
        coSignerAccounts: vault.coSignerAccounts,
        watchlistEntries: emptyCollection(),
        priceAlerts: emptyCollection(),
        gatedKeys: emptyCollection(),
        autopayOrders: emptyCollection(),
        signers: emptyCollection(),
        ...overrides,
    };
}

async function openVault() {
    const backend = new GatedBackend();
    const vault = new Vault({ backend, masterKey: new Uint8Array(32).fill(9) });
    await vault.open();
    return { backend, vault };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('wallet removal racing an agent account write', () => {
    it('does not let a window write recreate the deleted account', async () => {
        const { backend, vault } = await openVault();
        const record = agentAccount('wallet-1', 'bcrt1paggregatetarget');
        await vault.coSignerAccounts.put(record);

        backend.close();
        const blocker = vault.coSignerAccounts.put(agentAccount('wallet-2', 'bcrt1paggregateother'));
        const removal = removeWallet({ vault: removalVault(vault), walletId: 'wallet-1' });
        await settle();
        const write = createVaultWindowPersistence(vault, record.id).write(WINDOW);
        await settle();
        backend.release();

        await blocker;
        const removed = await removal;
        await write.catch(() => {});
        expect(removed.removed.coSignerAccounts).toBe(1);
        expect(await vault.coSignerAccounts.get(record.id)).toBeNull();
        expect(await vault.coSignerAccounts.findBy('walletId', 'wallet-1')).toEqual([]);
    });

    it('waits for an in-flight decision, then deletes the account', async () => {
        const { backend, vault } = await openVault();
        const record = agentAccount('wallet-1', 'bcrt1paggregatetarget');
        await vault.coSignerAccounts.put(record);

        let finishDecision;
        const decisionMayFinish = new Promise((resolve) => { finishDecision = resolve; });
        const decision = withAccountLock(record.id, async () => {
            await decisionMayFinish;
            await createVaultWindowPersistence(vault, record.id, {}, { accountLocked: true }).write(WINDOW);
        });
        const removal = removeWallet({ vault: removalVault(vault), walletId: 'wallet-1' });
        await settle();
        backend.close();
        finishDecision();
        await settle();
        backend.release();

        await decision;
        await removal;
        expect(await vault.coSignerAccounts.get(record.id)).toBeNull();
    });

    it('deletes an account added for the wallet while the removal runs', async () => {
        const { vault } = await openVault();
        const late = agentAccount('wallet-1', 'bcrt1paggregatelate');
        const signers = {
            ...emptyCollection(),
            findBy: async () => {
                await vault.coSignerAccounts.put(late);
                return [];
            },
        };

        const result = await removeWallet({ vault: removalVault(vault, { signers }), walletId: 'wallet-1' });

        expect(await vault.coSignerAccounts.get(late.id)).toBeNull();
        expect(result.removed.coSignerAccounts).toBe(1);
    });
});
