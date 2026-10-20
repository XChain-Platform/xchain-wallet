// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A refused queue write must reach the host, not resolve as success: the
// renderer-enqueue lane's blob is its only durable copy of signed bytes.
//
//   1. chrome.storage reports a refusal through `lastError`, so write and
//      remove reject when it is set and resolve when it is not.
//   2. localStorage reports one by throwing, and the adapter lets it reject.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    BROADCAST_QUEUE_STORAGE_VERSION,
    createBroadcastQueueStorage,
} from '../../../packages/extension/src/background/broadcastQueueStorage.js';
import { BROADCAST_QUEUE_STORAGE_KEY } from '../../../packages/core/src/shared/utils/wipeWalletStorage.js';

const REFUSAL = { message: 'QUOTA_BYTES quota exceeded' };

// A chrome.storage.local stub whose set/remove raise `lastError` for the callback when refusing.
function stubChrome({ refuse }) {
    const runtime = { lastError: undefined };
    const settle = (cb) => {
        if (refuse) runtime.lastError = REFUSAL;
        cb();
        runtime.lastError = undefined;
    };
    const chrome = {
        runtime,
        storage: {
            local: {
                get: (_key, cb) => cb({}),
                set: (_items, cb) => settle(cb),
                remove: (_key, cb) => settle(cb),
            },
        },
    };
    vi.stubGlobal('chrome', chrome);
}

function statefulChromeStorage({ value, refuseWrites = false }) {
    const runtime = { lastError: undefined };
    const faults = { refuseWrites };
    const values = value === undefined
        ? {}
        : { [BROADCAST_QUEUE_STORAGE_KEY]: structuredClone(value) };
    const set = vi.fn((items, cb) => {
        if (faults.refuseWrites) runtime.lastError = REFUSAL;
        else Object.assign(values, structuredClone(items));
        cb();
        runtime.lastError = undefined;
    });
    vi.stubGlobal('chrome', {
        runtime,
        storage: {
            local: {
                get: (key, cb) => cb({ [key]: structuredClone(values[key]) }),
                set,
                remove: (key, cb) => { delete values[key]; cb(); },
            },
        },
    });
    return { faults, set, values };
}

function stubLocalStorage({ refuse }) {
    vi.stubGlobal('chrome', undefined);
    const fail = () => { throw new Error('QuotaExceededError'); };
    vi.stubGlobal('localStorage', {
        getItem: () => null,
        setItem: refuse ? fail : () => {},
        removeItem: refuse ? fail : () => {},
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('chrome.storage adapter reports a refused write', () => {
    it('rejects save, saveSettlements and clear when lastError is set', async () => {
        stubChrome({ refuse: true });
        const storage = createBroadcastQueueStorage();
        await expect(storage.save({ w1: [] })).rejects.toThrow(/write refused: QUOTA_BYTES/);
        await expect(storage.saveSettlements([])).rejects.toThrow(/write refused/);
        await expect(storage.clear()).rejects.toThrow(/remove refused/);
    });

    it('resolves save and clear when the store accepted them', async () => {
        stubChrome({ refuse: false });
        const storage = createBroadcastQueueStorage();
        await expect(storage.save({ w1: [] })).resolves.toBeUndefined();
        await expect(storage.clear()).resolves.toBeUndefined();
    });
});

describe('localStorage adapter reports a refused write', () => {
    it('rejects save and clear when setItem and removeItem throw', async () => {
        stubLocalStorage({ refuse: true });
        const storage = createBroadcastQueueStorage();
        await expect(storage.save({ w1: [] })).rejects.toThrow(/QuotaExceededError/);
        await expect(storage.clear()).rejects.toThrow(/QuotaExceededError/);
    });

    it('resolves save and clear when the store accepted them', async () => {
        stubLocalStorage({ refuse: false });
        const storage = createBroadcastQueueStorage();
        await expect(storage.save({ w1: [] })).resolves.toBeUndefined();
        await expect(storage.clear()).resolves.toBeUndefined();
    });
});

// The fields that tie an entry to its vault record and its ADS verdict must
// survive the real parse, on the envelope blob and on the pre-journal blob.
describe('a stored entry keeps every field the host writes', () => {
    const ENTRY = {
        id: 'q-1', chainId: 'bitcoin-regtest', signedTxHex: 'hex-1', summary: 'Send 1', signedAt: 1, txid: 'txid-1',
        pendingTxId: 'p-1', resumedClaim: true, adsCommit: { chainId: 'bitcoin-regtest', donationIncluded: true },
    };

    function statefulLocalStorage() {
        vi.stubGlobal('chrome', undefined);
        const items = new Map();
        const setItem = vi.fn((k, v) => { items.set(k, String(v)); });
        vi.stubGlobal('localStorage', {
            getItem: (k) => (items.has(k) ? items.get(k) : null),
            setItem,
            removeItem: (k) => { items.delete(k); },
        });
        return { items, setItem };
    }

    it('round-trips through a save and a fresh adapter load', async () => {
        statefulLocalStorage();
        await createBroadcastQueueStorage().save({ w1: [ENTRY] });
        expect(await createBroadcastQueueStorage().load()).toEqual({ w1: [ENTRY] });
    });

    it.each([
        ['direct queue map', { w1: [ENTRY] }, []],
        ['unversioned journal envelope', {
            queues: { w1: [ENTRY] },
            settlements: [{ id: 's-1', pendingTxId: 'p-1', op: 'discard' }],
        }, [{ id: 's-1', pendingTxId: 'p-1', op: 'discard' }]],
    ])('migrates the %s fixture once and records its version', async (_label, fixture, settlements) => {
        const { set, values } = statefulChromeStorage({ value: fixture });

        const first = createBroadcastQueueStorage();
        expect(await first.load()).toEqual({ w1: [ENTRY] });
        expect(await first.loadSettlements()).toEqual(settlements);
        expect(values[BROADCAST_QUEUE_STORAGE_KEY]).toEqual({
            storageVersion: BROADCAST_QUEUE_STORAGE_VERSION,
            queues: { w1: [ENTRY] },
            settlements,
        });
        expect(set).toHaveBeenCalledTimes(1);

        await createBroadcastQueueStorage().load();
        expect(set).toHaveBeenCalledTimes(1);
    });

    it('keeps legacy data readable and intact when its migration write fails', async () => {
        const legacy = { w1: [ENTRY] };
        const { faults, set, values } = statefulChromeStorage({ value: legacy, refuseWrites: true });

        const storage = createBroadcastQueueStorage();
        await expect(storage.load()).resolves.toEqual({ w1: [ENTRY] });
        expect(values[BROADCAST_QUEUE_STORAGE_KEY]).toEqual(legacy);
        expect(set).toHaveBeenCalledOnce();

        faults.refuseWrites = false;
        await expect(storage.load()).resolves.toEqual({ w1: [ENTRY] });
        expect(values[BROADCAST_QUEUE_STORAGE_KEY]).toEqual({
            storageVersion: BROADCAST_QUEUE_STORAGE_VERSION,
            queues: { w1: [ENTRY] },
            settlements: [],
        });
    });

    it('reads an unknown version without rewriting it', async () => {
        const future = {
            storageVersion: BROADCAST_QUEUE_STORAGE_VERSION + 1,
            queues: { w1: [ENTRY] },
            settlements: [],
            futureField: true,
        };
        const { set, values } = statefulChromeStorage({ value: future });

        await expect(createBroadcastQueueStorage().load()).resolves.toEqual({ w1: [ENTRY] });
        expect(values[BROADCAST_QUEUE_STORAGE_KEY]).toEqual(future);
        expect(set).not.toHaveBeenCalled();
    });
});

describe('a blob a newer build wrote is never overwritten', () => {
    const ENTRY = { id: 'q-1', chainId: 'bitcoin-regtest', signedTxHex: 'hex-1', summary: 'Send 1', signedAt: 1, pendingTxId: 'p-1' };
    const future = () => ({
        storageVersion: BROADCAST_QUEUE_STORAGE_VERSION + 1,
        queues: { w1: [ENTRY] },
        settlements: [],
        futureField: true,
    });
    const current = (queues = {}) => ({ storageVersion: BROADCAST_QUEUE_STORAGE_VERSION, queues, settlements: [] });

    it('refuses save and saveSettlements after loading it, leaving the stored value intact', async () => {
        const { set, values } = statefulChromeStorage({ value: future() });
        const storage = createBroadcastQueueStorage();
        await storage.load();

        await expect(storage.save({ w1: [ENTRY] })).rejects.toThrow(/newer/);
        await expect(storage.saveSettlements([])).rejects.toThrow(/newer/);
        expect(values[BROADCAST_QUEUE_STORAGE_KEY]).toEqual(future());
        expect(set).not.toHaveBeenCalled();
    });

    it('writes again after a clear, or after a later load reads a supported version', async () => {
        const { values } = statefulChromeStorage({ value: future() });
        const wiped = createBroadcastQueueStorage();
        await wiped.load();
        await wiped.clear();
        await expect(wiped.save({})).resolves.toBeUndefined();
        expect(values[BROADCAST_QUEUE_STORAGE_KEY]).toEqual(current());

        values[BROADCAST_QUEUE_STORAGE_KEY] = future();
        const reread = createBroadcastQueueStorage();
        await reread.load();
        values[BROADCAST_QUEUE_STORAGE_KEY] = current({ w1: [ENTRY] });
        await reread.load();
        await expect(reread.save({})).resolves.toBeUndefined();
        expect(values[BROADCAST_QUEUE_STORAGE_KEY]).toEqual(current());
    });

    it('still replaces a malformed version on the next save', async () => {
        const { set, values } = statefulChromeStorage({ value: { storageVersion: 'two', queues: { w1: [ENTRY] } } });
        const storage = createBroadcastQueueStorage();
        await storage.load();
        expect(set).not.toHaveBeenCalled();

        await storage.save({ w1: [ENTRY] });
        expect(values[BROADCAST_QUEUE_STORAGE_KEY]).toEqual(current({ w1: [ENTRY] }));
    });
});
