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
// G4: the passive co-signer's load -> decide -> charge -> persist bracket must
// be atomic.
//
// `CoSigner.process()` being synchronous is NOT sufficient, and an earlier
// revision of the spec wrongly claimed it was. The wallet wraps that
// synchronous call in an ASYNC Vault load and an ASYNC persist, and rebuilds
// the store per request, so without an exclusive lock two concurrent requests
// both await the same PRE-CHARGE snapshot, both decide against it, both are
// approved, and the second persist overwrites the first. One authorization
// then goes uncharged - against a policy the operator sized to bound exactly
// that - and an approval is irrevocable once handed out.

import { describe, it, expect } from 'vitest';
import { passiveCoSign } from '../../../packages/core/src/flows/passiveCoSign.js';
import {
    VaultWindowStore,
    createInMemoryWindowPersistence,
} from '../../../packages/core/src/cosigner/vaultWindowStore.js';

const KEY = new Uint8Array(32).fill(7);
const PUBKEYS = ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)];
const POLICY = { allowedActions: ['SEND'], maxPerWindow: { hours: 24, maxActions: 1 } };
const REQUEST = { psbt: 'aabbccdd', agentPublicNonce: '03' + 'c'.repeat(130), inputIndex: 0 };

// A CoSigner mock that enforces the ONE thing this test is about: it reads the
// window snapshot, refuses once maxActions is reached, and charges the store on
// approval. That is exactly the real evaluator's shape for a count cap.
function mockSdk() {
    return {
        coSigner: {
            CoSigner: class {
                constructor(config) { this.config = config; }
                process() {
                    const store = this.config.windowStore;
                    const usage = store.snapshot();
                    if (usage.count + 1 > POLICY.maxPerWindow.maxActions)
                        return { approved: false, reason: 'POLICY_WINDOW_COUNT_EXCEEDED' };
                    store.record({ action: 'SEND', tick: 'TOK', amount: '1', txid: null });
                    return { approved: true, action: 'SEND', publicNonce: 'aa', sig: 'bb', msg: 'cc' };
                }
            },
        },
    };
}

// A persistence port with a REAL async gap on read and write, so two overlapping
// requests genuinely interleave. Without the lock the second request's read
// resolves before the first request's write lands.
function slowPersistence() {
    let store = null;
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
    return {
        async read() { await tick(); return store ? JSON.parse(JSON.stringify(store)) : null; },
        async write(state) { await tick(); store = JSON.parse(JSON.stringify(state)); },
        dump() { return store ? JSON.parse(JSON.stringify(store)) : null; },
    };
}

describe('passiveCoSign atomicity (G4)', () => {

    it('serializes concurrent requests for one account, so a window cap of 1 approves once', async () => {
        const persistence = slowPersistence();
        const sdk = mockSdk();
        // A FRESH store per request: this is what the account-level flow does
        // (buildAccountWindowStore), and it is precisely why an identity-keyed
        // lock would not fire. The lock has to key on the account.
        const run = () => passiveCoSign({
            sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST,
            windowStore: new VaultWindowStore({ persistence, hours: 24 }),
            lockKey: 'account-under-test',
        });

        const [a, b] = await Promise.all([run(), run()]);
        const approvals = [a, b].filter((r) => r.approved).length;

        expect(approvals, 'a maxActions:1 window must authorize exactly one of two concurrent requests')
            .toBe(1);
        expect(persistence.dump().entries).toHaveLength(1);
        const denied = [a, b].find((r) => !r.approved);
        expect(denied.reason).toBe('POLICY_WINDOW_COUNT_EXCEEDED');
    });

    it('holds the cap across a burst, not just a pair', async () => {
        const persistence = slowPersistence();
        const sdk = mockSdk();
        const results = await Promise.all(Array.from({ length: 8 }, () => passiveCoSign({
            sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST,
            windowStore: new VaultWindowStore({ persistence, hours: 24 }),
            lockKey: 'burst-account',
        })));
        expect(results.filter((r) => r.approved)).toHaveLength(1);
        expect(persistence.dump().entries).toHaveLength(1);
    });

    it('serializes on a shared store instance even with no lock key', async () => {
        const persistence = slowPersistence();
        const sdk = mockSdk();
        const shared = new VaultWindowStore({ persistence, hours: 24 });
        const run = () => passiveCoSign({
            sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST,
            windowStore: shared,
        });
        const results = await Promise.all([run(), run(), run()]);
        expect(results.filter((r) => r.approved)).toHaveLength(1);
    });

    it('does not let one account block another', async () => {
        // The lock is per account, not global: two different accounts must not
        // serialize behind each other.
        const sdk = mockSdk();
        const one = slowPersistence(), two = slowPersistence();
        const [a, b] = await Promise.all([
            passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST,
                windowStore: new VaultWindowStore({ persistence: one, hours: 24 }), lockKey: 'acct-one' }),
            passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST,
                windowStore: new VaultWindowStore({ persistence: two, hours: 24 }), lockKey: 'acct-two' }),
        ]);
        expect(a.approved).toBe(true);
        expect(b.approved).toBe(true);
    });

    it('refuses rather than returning a signature the charge did not survive', async () => {
        // An approval is irrevocable, so it must never be handed out against a
        // charge that only ever existed in memory.
        const sdk = mockSdk();
        const persistence = {
            async read() { return null; },
            async write() { throw new Error('vault write failed'); },
        };
        const res = await passiveCoSign({
            sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST,
            windowStore: new VaultWindowStore({ persistence, hours: 24 }),
            lockKey: 'persist-fails',
        });
        expect(res.approved).toBe(false);
        expect(res.reason).toBe('WINDOW_PERSIST_FAILED');
        expect(res.sig).toBeUndefined();
    });

    it('a failed request does not wedge the queue behind it', async () => {
        const persistence = slowPersistence();
        const boom = {
            coSigner: {
                CoSigner: class { process() { throw new Error('boom'); } },
            },
        };
        await expect(passiveCoSign({
            sdk: boom, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST,
            windowStore: new VaultWindowStore({ persistence, hours: 24 }), lockKey: 'wedge-test',
        })).rejects.toThrow(/boom/);

        const after = await passiveCoSign({
            sdk: mockSdk(), secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST,
            windowStore: new VaultWindowStore({ persistence, hours: 24 }), lockKey: 'wedge-test',
        });
        expect(after.approved).toBe(true);
    });
});
