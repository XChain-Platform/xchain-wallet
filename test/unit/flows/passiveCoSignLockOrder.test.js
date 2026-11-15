// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
// Lock order for the passive co-sign bracket: the account lock first, the keyed
// slot second. A direct caller that passes a lockKey with a store whose write()
// takes the account lock itself would queue for that lock while holding the
// keyed slot, the reverse of the production order, so it is refused. The keyed
// slot is released once an account has nothing in flight.

import { describe, it, expect } from 'vitest';
import { passiveCoSign, keyedLockCount } from '../../../packages/core/src/flows/passiveCoSign.js';
import { withAccountLock } from '../../../packages/core/src/cosigner/accountLock.js';
import { buildAccountWindowStore } from '../../../packages/core/src/cosigner/vaultWindowPersistence.js';
import { createCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

const KEY = new Uint8Array(32).fill(7);
const AGENT = '02' + 'a'.repeat(64);
const DAEMON = '02' + 'b'.repeat(64);
const POLICY = { allowedActions: ['SEND'], maxPerWindow: { hours: 24, maxActions: 5 } };
const REQUEST = { psbt: 'aabbccdd', agentPublicNonce: '03' + 'c'.repeat(130), inputIndex: 0 };

function mockSdk() {
    return {
        coSigner: {
            CoSigner: class {
                constructor(config) { this.config = config; }
                process() {
                    this.config.windowStore.record({ action: 'SEND', tick: 'TOK', amount: '1', txid: null });
                    return { approved: true, action: 'SEND', signatures: [] };
                }
            },
        },
    };
}

async function openVaultWithAccount() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
    await vault.open();
    const record = createCoSignerAccount({
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        aggregateAddress: 'bcrt1paggregateexample',
        agentPubkey: AGENT,
        daemonPubkey: DAEMON,
        daemonDerivationPath: "m/86'/0'/0'/0/3",
        publicKeyOrder: [AGENT, DAEMON],
        policy: POLICY,
    });
    await vault.coSignerAccounts.put(record);
    return { vault, record };
}

const decide = (windowStore, lockKey) => passiveCoSign({
    sdk: mockSdk(), secretKey: KEY, publicKeys: [AGENT, DAEMON], policy: POLICY,
    request: REQUEST, windowStore, lockKey,
});

describe('passiveCoSign lock order', () => {
    it('refuses a lockKey paired with a store that takes the account lock itself', async () => {
        const { vault, record } = await openVaultWithAccount();
        const store = buildAccountWindowStore({ vault, account: record });

        await expect(decide(store, record.id)).rejects.toThrow(/accountLocked/);
    });

    it('does not wedge the account lock when that pairing is refused', async () => {
        const { vault, record } = await openVaultWithAccount();
        await expect(decide(buildAccountWindowStore({ vault, account: record }), record.id)).rejects.toThrow();

        await expect(withAccountLock(record.id, async () => 'free')).resolves.toBe('free');
        expect(keyedLockCount()).toBe(0);
    });

    it('completes the documented order against a concurrent account-lock holder', async () => {
        const { vault, record } = await openVaultWithAccount();
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        const holder = withAccountLock(record.id, () => held);

        const run = withAccountLock(record.id, () => decide(
            buildAccountWindowStore({ vault, account: record, accountLocked: true }), record.id,
        ));
        release();
        await holder;

        expect((await run).approved).toBe(true);
        expect((await vault.coSignerAccounts.get(record.id)).window.entries).toHaveLength(1);
    });
});

describe('passiveCoSign keyed lock release', () => {
    const noLockStore = (id) => ({
        load: async () => {}, flush: async () => {}, record() {}, snapshot: () => ({ count: 0, perTick: {} }),
        id,
    });

    it('holds no slot once a request has settled', async () => {
        const before = keyedLockCount();
        await decide(noLockStore('a'), 'release-account');
        await Promise.resolve();
        await Promise.resolve();
        expect(keyedLockCount()).toBe(before);
    });

    it('holds one slot per account while a request is queued, then none', async () => {
        const before = keyedLockCount();
        const runs = [decide(noLockStore('a'), 'queued-one'), decide(noLockStore('b'), 'queued-one'),
            decide(noLockStore('c'), 'queued-two')];
        expect(keyedLockCount()).toBe(before + 2);
        await Promise.all(runs);
        await Promise.resolve();
        await Promise.resolve();
        expect(keyedLockCount()).toBe(before);
    });

    it('still serializes a second burst after the slot was released', async () => {
        const order = [];
        const store = (name, ms) => ({
            ...noLockStore(name),
            load: async () => { order.push(name + ':start'); await new Promise((r) => setTimeout(r, ms)); },
            flush: async () => { order.push(name + ':end'); },
        });
        await decide(store('first', 1), 'reburst');
        await Promise.all([decide(store('x', 15), 'reburst'), decide(store('y', 1), 'reburst')]);

        expect(order.slice(2)).toEqual(['x:start', 'x:end', 'y:start', 'y:end']);
    });
});
