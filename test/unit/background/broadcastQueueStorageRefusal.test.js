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
import { createBroadcastQueueStorage } from '../../../packages/extension/src/background/broadcastQueueStorage.js';
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
        vi.stubGlobal('localStorage', {
            getItem: (k) => (items.has(k) ? items.get(k) : null),
            setItem: (k, v) => { items.set(k, String(v)); },
            removeItem: (k) => { items.delete(k); },
        });
        return items;
    }

    it('round-trips through a save and a fresh adapter load', async () => {
        statefulLocalStorage();
        await createBroadcastQueueStorage().save({ w1: [ENTRY] });
        expect(await createBroadcastQueueStorage().load()).toEqual({ w1: [ENTRY] });
    });

    it('reads them from a top-level blob written before the journal existed', async () => {
        const items = statefulLocalStorage();
        items.set(BROADCAST_QUEUE_STORAGE_KEY, JSON.stringify({ w1: [ENTRY] }));
        expect(await createBroadcastQueueStorage().load()).toEqual({ w1: [ENTRY] });
    });
});
