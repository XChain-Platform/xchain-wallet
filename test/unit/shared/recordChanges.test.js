// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    subscribeRecordChanges,
    withRecordChanges,
} from '../../../packages/core/src/shared/utils/recordChanges.js';

const unsubscribers = [];
function listen() {
    const topics = [];
    unsubscribers.push(subscribeRecordChanges((topic) => topics.push(topic)));
    return topics;
}

afterEach(() => {
    while (unsubscribers.length) unsubscribers.pop()();
});

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('withRecordChanges', () => {
    it('publishes a write\'s topic only after the write resolves', async () => {
        let finish;
        const messaging = { updateCoSignerAccount: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
        const topics = listen();
        const pending = withRecordChanges(messaging).updateCoSignerAccount({ id: 'a', patch: {} });
        await flush();
        expect(topics).toEqual([]);
        finish({ id: 'a' });
        await expect(pending).resolves.toEqual({ id: 'a' });
        await flush();
        expect(topics).toEqual(['cosigner-accounts']);
        expect(messaging.updateCoSignerAccount).toHaveBeenCalledWith({ id: 'a', patch: {} });
    });

    it('publishes nothing for a refused write, and the caller still sees the refusal', async () => {
        const messaging = { setActiveAddress: vi.fn().mockRejectedValue(new Error('locked')) };
        const topics = listen();
        await expect(withRecordChanges(messaging).setActiveAddress('acct', 'chain', 'id')).rejects.toThrow('locked');
        await flush();
        expect(topics).toEqual([]);
    });

    it('passes reads through untouched and publishes nothing for them', async () => {
        const read = vi.fn().mockResolvedValue([]);
        const messaging = { listCoSignerAccounts: read, version: 3 };
        const topics = listen();
        const tracked = withRecordChanges(messaging);
        expect(tracked.listCoSignerAccounts).toBe(read);
        expect(tracked.version).toBe(3);
        expect(tracked.renameWallet).toBeUndefined();
        await tracked.listCoSignerAccounts({ walletId: 'w' });
        await flush();
        expect(topics).toEqual([]);
    });

    it('keeps one wrapper per module and calls writes on the module itself', async () => {
        const messaging = {
            calls: 0,
            async setAddressLabel() { this.calls += 1; return { ok: true }; },
        };
        const tracked = withRecordChanges(messaging);
        expect(withRecordChanges(messaging)).toBe(tracked);
        expect(tracked.setAddressLabel).toBe(tracked.setAddressLabel);
        await tracked.setAddressLabel();
        expect(messaging.calls).toBe(1);
    });

    // A production bundle emits `import * as messaging` as a frozen,
    // null-prototype object, whose members a proxy may not swap.
    it('tracks writes on a frozen module and still lists, spreads and re-wraps it', async () => {
        const read = vi.fn().mockResolvedValue([]);
        const messaging = Object.freeze({
            __proto__: null,
            listCoSignerAccounts: read,
            updateCoSignerAccount: vi.fn().mockResolvedValue({ id: 'a' }),
        });
        const topics = listen();
        const tracked = withRecordChanges(messaging);

        await expect(tracked.updateCoSignerAccount({ id: 'a', patch: {} })).resolves.toEqual({ id: 'a' });
        await flush();
        expect(topics).toEqual(['cosigner-accounts']);
        expect('listCoSignerAccounts' in tracked).toBe(true);
        expect('renameWallet' in tracked).toBe(false);
        expect(Object.keys(tracked).sort()).toEqual(['listCoSignerAccounts', 'updateCoSignerAccount']);
        const spread = { ...tracked };
        expect(spread.listCoSignerAccounts).toBe(read);
        await spread.updateCoSignerAccount({ id: 'a', patch: {} });
        await flush();
        expect(topics).toEqual(['cosigner-accounts', 'cosigner-accounts']);

        // A screen may layer its own proxy on the module it was handed.
        const layered = new Proxy(tracked, {
            get(target, prop) { return prop === 'listCoSignerAccounts' ? () => 'layered' : target[prop]; },
        });
        expect(layered.listCoSignerAccounts()).toBe('layered');
    });
});
