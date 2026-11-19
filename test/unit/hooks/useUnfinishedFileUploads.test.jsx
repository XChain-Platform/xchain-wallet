// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useUnfinishedFileUploads } from '../../../packages/core/src/shared/hooks/useUnfinishedFileUploads.js';

const WALLET_ID = 'wallet-1';

function route(id, stage, extra = {}) {
    return {
        id,
        stage,
        name: `${id}.bin`,
        partsSent: 2,
        totalParts: 5,
        paidTransactions: [`${id}-payment`],
        ...extra,
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((settle) => { resolve = settle; });
    return { promise, resolve };
}

function messagingWith(uploads) {
    return {
        listPendingFileUploads: vi.fn().mockResolvedValue({ uploads }),
        discardPendingFileUpload: vi.fn().mockResolvedValue(undefined),
    };
}

function mountHook(messaging, walletId = WALLET_ID) {
    return renderHook(
        (props) => useUnfinishedFileUploads({ messaging, walletId: props.walletId }),
        { initialProps: { walletId } },
    );
}

async function waitUntilLoaded(result) {
    await waitFor(() => expect(result.current.loading).toBe(false));
}

afterEach(() => { vi.clearAllMocks(); });

describe('pending upload buckets', () => {
    it.each(['funding', 'sending', 'assembling'])('puts %s uploads in unfinished', async (stage) => {
        const entry = route(stage, stage);
        const { result } = mountHook(messagingWith([entry]));
        await waitUntilLoaded(result);

        expect(result.current.unfinished).toEqual([{
            id: entry.id,
            name: entry.name,
            partsSent: entry.partsSent,
            totalParts: entry.totalParts,
            paidTransactions: entry.paidTransactions,
        }]);
        expect(result.current.failed).toEqual([]);
    });

    it('puts mismatch uploads in failed and drops complete uploads', async () => {
        const mismatch = route('bad', 'mismatch');
        const { result } = mountHook(messagingWith([mismatch, route('done', 'complete')]));
        await waitUntilLoaded(result);

        expect(result.current.unfinished).toEqual([]);
        expect(result.current.failed).toEqual([{
            id: mismatch.id,
            name: mismatch.name,
            partsSent: mismatch.partsSent,
            totalParts: mismatch.totalParts,
            paidTransactions: mismatch.paidTransactions,
        }]);
        expect(result.current.uploadById('done')).toBe(null);
    });
});

describe('route lookup', () => {
    it('returns the unchanged route entry by id and null for a miss', async () => {
        const entry = route('upload-1', 'sending', { futureRouteField: 'preserved' });
        const { result } = mountHook(messagingWith([entry]));
        await waitUntilLoaded(result);

        expect(result.current.uploadById('upload-1')).toBe(entry);
        expect(result.current.uploadById('missing')).toBe(null);
    });
});

describe('successful discard', () => {
    it('calls the route once, drops the entry locally, and returns its payments', async () => {
        const entry = route('upload-1', 'sending');
        const messaging = messagingWith([entry]);
        messaging.discardPendingFileUpload.mockResolvedValue({ paidTransactions: 7 });
        const { result } = mountHook(messaging);
        await waitUntilLoaded(result);

        let paidTransactions;
        await act(async () => { paidTransactions = await result.current.discard(entry.id); });

        expect(messaging.discardPendingFileUpload).toHaveBeenCalledTimes(1);
        expect(messaging.discardPendingFileUpload).toHaveBeenCalledWith({ walletId: WALLET_ID, id: entry.id });
        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(1);
        expect(result.current.unfinished).toEqual([]);
        expect(paidTransactions).toBe(7);
    });
});

describe('failed discard', () => {
    it('keeps the entry and exposes the rejection message', async () => {
        const entry = route('upload-1', 'sending');
        const messaging = messagingWith([entry]);
        messaging.discardPendingFileUpload.mockRejectedValue(new Error('discard denied'));
        const { result } = mountHook(messaging);
        await waitUntilLoaded(result);

        await act(async () => {
            await expect(result.current.discard(entry.id)).rejects.toThrow('discard denied');
        });

        expect(result.current.uploadById(entry.id)).toBe(entry);
        expect(result.current.error).toBe('discard denied');
        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(1);
    });
});

describe('stale list replies', () => {
    it('drops a reply for an earlier wallet after the wallet changes', async () => {
        const first = deferred();
        const second = deferred();
        const messaging = {
            listPendingFileUploads: vi.fn()
                .mockReturnValueOnce(first.promise)
                .mockReturnValueOnce(second.promise),
        };
        const { result, rerender } = mountHook(messaging);

        rerender({ walletId: 'wallet-2' });
        await act(async () => { second.resolve({ uploads: [route('new', 'funding')] }); });
        expect(result.current.unfinished.map(({ id }) => id)).toEqual(['new']);

        await act(async () => { first.resolve({ uploads: [route('old', 'sending')] }); });
        expect(result.current.unfinished.map(({ id }) => id)).toEqual(['new']);
        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(2);
    });
});

describe('unavailable list inputs', () => {
    it('returns empty non-loading lists without a list function', () => {
        const { result } = mountHook({});
        expect(result.current.unfinished).toEqual([]);
        expect(result.current.failed).toEqual([]);
        expect(result.current.loading).toBe(false);
    });

    it('does not call messaging for an empty wallet id', () => {
        const messaging = messagingWith([route('upload-1', 'funding')]);
        const { result } = mountHook(messaging, '');
        expect(result.current.unfinished).toEqual([]);
        expect(result.current.failed).toEqual([]);
        expect(result.current.loading).toBe(false);
        expect(messaging.listPendingFileUploads).not.toHaveBeenCalled();
    });
});

describe('refresh', () => {
    it('lists exactly once more and replaces the buckets', async () => {
        const messaging = messagingWith([route('first', 'funding')]);
        messaging.listPendingFileUploads.mockResolvedValueOnce({ uploads: [route('first', 'funding')] })
            .mockResolvedValueOnce({ uploads: [route('second', 'mismatch')] });
        const { result } = mountHook(messaging);
        await waitUntilLoaded(result);

        await act(async () => { await result.current.refresh(); });

        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(2);
        expect(result.current.unfinished).toEqual([]);
        expect(result.current.failed.map(({ id }) => id)).toEqual(['second']);
    });
});

describe('list call cardinality', () => {
    it.each([1, 6])('lists once for %i returned entries', async (count) => {
        const uploads = Array.from({ length: count }, (_, index) => route(`upload-${index}`, 'sending'));
        const messaging = messagingWith(uploads);
        const { result } = mountHook(messaging);
        await waitUntilLoaded(result);

        expect(result.current.unfinished).toHaveLength(count);
        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(1);
        expect(messaging.listPendingFileUploads).toHaveBeenCalledWith({ walletId: WALLET_ID });
    });
});

describe('failed list', () => {
    it('exposes the rejection message with both lists empty', async () => {
        const messaging = messagingWith([]);
        messaging.listPendingFileUploads.mockRejectedValue(new Error('list unavailable'));
        const { result } = mountHook(messaging);

        await waitFor(() => expect(result.current.error).toBe('list unavailable'));

        expect(result.current.loading).toBe(false);
        expect(result.current.unfinished).toEqual([]);
        expect(result.current.failed).toEqual([]);
    });
});
