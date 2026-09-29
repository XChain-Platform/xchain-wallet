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
