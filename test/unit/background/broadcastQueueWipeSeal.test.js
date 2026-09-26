// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet wipe seals the queued-broadcast surface before it removes the key.
//
// A queue broadcast persists and journals AFTER its network await, and that
// continuation can resolve after the wipe removed `xchain.broadcastQueue`. The
// storage adapter still caches the pre-wipe halves, so an unsealed write puts
// the wiped wallet's signed bytes and journal back under a key nothing lists.
// The second case is the negative control: the same race with no seal.

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { createBroadcastQueueStorage } from '../../../packages/extension/src/background/broadcastQueueStorage.js';

const CHAIN = 'bitcoin-regtest';
const W = 'w1';
const KEY = 'xchain.broadcastQueue';

function fakeChrome() {
    const store = {};
    return {
        store,
        api: {
            runtime: {},
            storage: {
                local: {
                    get: (key, cb) => cb({ [key]: store[key] }),
                    set: (obj, cb) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); cb(); },
                    remove: (key, cb) => { delete store[key]; cb(); },
                },
            },
        },
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

const entry = (id, extra = {}) => ({ id, chainId: CHAIN, signedTxHex: `hex-${id}`, summary: id, signedAt: 1, ...extra });

function makeHost(broadcastTx) {
    const host = createBackgroundHost({
        vault: {
            pendingTxs: {
                get: async () => { throw new Error('VaultStateError: vault is closed'); },
                put: async () => {},
                list: async () => [],
                delete: async () => {},
                find: async () => null,
                findBy: async () => [],
            },
            wallets: { list: async () => [{ id: W }] },
            settings: {
                get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }),
                put: async () => {},
            },
        },
        chainRegistry: {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }),
            list: () => [],
        },
        sdkRegistry: { get: () => ({ encoder: { broadcastTx } }), for: () => ({ encoder: { broadcastTx } }) },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: createBroadcastQueueStorage(),
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, call: (type, request) => host.handle({ type, request }) };
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

/** Start a broadcast, wipe the key while it awaits the network, then let it land. */
async function raceWipe({ seal }) {
    const fake = fakeChrome();
    const prior = globalThis.chrome;
    globalThis.chrome = fake.api;
    try {
        fake.store[KEY] = { queues: { [W]: [entry('A', { pendingTxId: 'p1' }), entry('B')] } };
        const gate = deferred();
        const h = makeHost(vi.fn(() => gate.promise));
        const inFlight = h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        await settle();

        if (seal) await h.host.sealBroadcastQueue();
        delete fake.store[KEY];

        gate.resolve('tx-A');
        await inFlight;
        await settle();
        return { store: fake.store, list: await h.call('broadcast.queue.list', { walletId: W }) };
    } finally {
        if (prior === undefined) delete globalThis.chrome;
        else globalThis.chrome = prior;
    }
}

describe('sealBroadcastQueue fences writes that resolve after the wipe', () => {
    it('leaves the queue key removed and serves nothing the wipe erased', async () => {
        const { store, list } = await raceWipe({ seal: true });
        expect(store[KEY]).toBeUndefined();
        expect(list.result).toEqual([]);
    });

    it('re-creates the key with the wiped entries when nothing sealed it', async () => {
        const { store } = await raceWipe({ seal: false });
        expect(store[KEY]).toBeDefined();
        expect(JSON.stringify(store[KEY])).toContain('hex-B');
    });
});
