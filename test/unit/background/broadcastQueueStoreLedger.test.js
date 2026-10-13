// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The pruned-wallet ledger lists its key names without reading the values of
// the whole chrome.storage.local area. Every awaited queue save, every boot and
// every seal lists it, and the same area holds the vault and the queue blob.
// Where getKeys is missing or fails, the old full read is the fallback and the
// ledger keeps its meaning, so the no-getKeys cases are the control.

import { describe, it, expect, afterEach } from 'vitest';
import { createBroadcastQueueStore, sealBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

const LEDGER = 'xchain.broadcastQueue.pruned.';
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

/** chrome.storage.local over a plain object, recording every full-area read. */
function installChrome({ withGetKeys, getKeysFails = false }) {
    const store = {
        'xchain-wallet:vault': 'ENCRYPTED-VAULT-BLOB',
        [`${LEDGER}w-kept`]: 1,
        [`${LEDGER}w-gone`]: 1,
    };
    const fullReads = [];
    const runtime = {};
    const local = {
        get: (key, cb) => {
            if (key === null) fullReads.push(key);
            cb(key === null ? { ...store } : { [key]: store[key] });
        },
        set: (obj, cb) => { Object.assign(store, obj); cb(); },
        remove: (keys, cb) => { for (const k of [].concat(keys)) delete store[k]; cb(); },
    };
    if (withGetKeys) {
        local.getKeys = async () => {
            if (getKeysFails) throw new Error('getKeys refused');
            return Object.keys(store);
        };
    }
    globalThis.chrome = { runtime, storage: { local } };
    return { store, fullReads };
}

/** A storage adapter whose blob is always readable. */
function memStorage() {
    return {
        load: async () => ({}),
        loadSettlements: async () => [],
        save: async () => {},
        saveSettlements: async () => {},
    };
}

afterEach(() => { delete globalThis.chrome; });

describe('broadcastQueueStore pruned-wallet ledger listing', () => {
    it.each([
        ['getKeys', { withGetKeys: true }, 0],
        ['a failing getKeys (falls back)', { withGetKeys: true, getKeysFails: true }, 1],
        ['no getKeys (falls back)', { withGetKeys: false }, 1],
    ])('a save forgets the wallets its snapshot no longer holds, with %s', async (_label, opts, expectedFullReads) => {
        const { store, fullReads } = installChrome(opts);
        const queueStore = createBroadcastQueueStore({ storage: memStorage() });
        await queueStore.storage.save({ 'w-kept': [{ id: 'e1' }] });
        expect(`${LEDGER}w-gone` in store).toBe(false);
        expect(`${LEDGER}w-kept` in store).toBe(true);
        expect(fullReads).toHaveLength(expectedFullReads);
    });

    it('a boot hydrates the prune set from key names alone', async () => {
        const { fullReads } = installChrome({ withGetKeys: true });
        const queueStore = createBroadcastQueueStore({ storage: memStorage() });
        await queueStore.storage.load();
        expect([...queueStore.prunedWallets].sort()).toEqual(['w-gone', 'w-kept']);
        expect(fullReads).toHaveLength(0);
    });

    it('a seal erases every ledger key without reading the area', async () => {
        const { store, fullReads } = installChrome({ withGetKeys: true });
        const queueStore = createBroadcastQueueStore({ storage: memStorage() });
        await sealBroadcastQueueStore(queueStore);
        await settle();
        expect(Object.keys(store)).toEqual(['xchain-wallet:vault']);
        expect(fullReads).toHaveLength(0);
    });
});
