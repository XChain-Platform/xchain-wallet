// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { resolveMultipartLinkTarget } from '../../../packages/core/src/flows/multipartLinkTarget.js';

const TXID = 'ab'.repeat(32);

function multipart(status = 'complete') {
    return {
        file_hash: 'cd'.repeat(32),
        total_parts: 3,
        parts_received: status === 'complete' ? 3 : 2,
        total_bytes: 900000,
        status,
    };
}

function detail(status = 'complete') {
    return { action: 'FILE', action_format: 1, status: 'valid', multipart: multipart(status) };
}

function explorerOf({ transactions, details = [detail()] }) {
    const txQueue = [...transactions];
    const detailQueue = [...details];
    return {
        getTransaction: vi.fn(async () => txQueue.shift() ?? txQueue.at(-1)),
        getAction: vi.fn(async () => detailQueue.shift() ?? detailQueue.at(-1)),
    };
}

function tx(action = 'FILE', actionIndex = 417) {
    return { tx_hash: TXID, actions: [{ action, action_index: actionIndex }] };
}

describe('complete multipart link target', () => {
    it('returns the explorer-derived manifest index using the SDK call shapes', async () => {
        const explorer = explorerOf({ transactions: [tx('FILE', 417)] });
        const result = await resolveMultipartLinkTarget({
            explorer, txid: TXID, coin: 'BTC', maxAttempts: 4, waitMs: 25, sleep: vi.fn(),
        });
        expect(result).toEqual({ ready: true, actionIndex: '417' });
        expect(explorer.getTransaction).toHaveBeenCalledWith(TXID, 'tx_hash');
        expect(explorer.getAction).toHaveBeenCalledWith('417');
    });
});

describe('pending multipart link target that completes', () => {
    it('re-resolves the transaction and uses only the injected sleep', async () => {
        const sleep = vi.fn(async () => {});
        const explorer = explorerOf({ transactions: [tx(), tx()], details: [detail('pending'), detail()] });
        const result = await resolveMultipartLinkTarget({
            explorer, txid: TXID, coin: 'BTC', maxAttempts: 2, waitMs: 86_400_000, sleep,
        });
        expect(result).toEqual({ ready: true, actionIndex: '417' });
        expect(sleep).toHaveBeenCalledOnce();
        expect(sleep).toHaveBeenCalledWith(86_400_000);
        expect(explorer.getTransaction).toHaveBeenCalledTimes(2);
    });
});

describe('pending multipart link target that stays pending', () => {
    it('stops at maxAttempts', async () => {
        const sleep = vi.fn(async () => {});
        const explorer = explorerOf({ transactions: [tx(), tx(), tx()], details: [detail('pending'), detail('pending'), detail('pending')] });
        await expect(resolveMultipartLinkTarget({
            explorer, txid: TXID, coin: 'BTC', maxAttempts: 3, waitMs: 9, sleep,
        })).resolves.toEqual({ ready: false, reason: 'pending' });
        expect(explorer.getAction).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });
});

describe('mismatched multipart link target', () => {
    it('is terminal and never sleeps', async () => {
        const sleep = vi.fn(async () => {});
        const explorer = explorerOf({ transactions: [tx()], details: [detail('mismatch')] });
        await expect(resolveMultipartLinkTarget({
            explorer, txid: TXID, coin: 'BTC', maxAttempts: 5, waitMs: 9, sleep,
        })).resolves.toEqual({ ready: false, reason: 'mismatch' });
        expect(explorer.getTransaction).toHaveBeenCalledOnce();
        expect(sleep).not.toHaveBeenCalled();
    });
});

describe('unindexed multipart link target', () => {
    it('polls the transaction only and returns not_indexed', async () => {
        const sleep = vi.fn(async () => {});
        const explorer = explorerOf({ transactions: [{ actions: [] }, { actions: [] }] });
        await expect(resolveMultipartLinkTarget({
            explorer, txid: TXID, coin: 'BTC', maxAttempts: 2, waitMs: 4, sleep,
        })).resolves.toEqual({ ready: false, reason: 'not_indexed' });
        expect(explorer.getAction).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledOnce();
    });
});

describe('wrong action link target', () => {
    it('rejects a transaction that did not index a FILE action', async () => {
        const sleep = vi.fn(async () => {});
        const explorer = explorerOf({ transactions: [tx('SEND')] });
        await expect(resolveMultipartLinkTarget({
            explorer, txid: TXID, coin: 'BTC', maxAttempts: 5, waitMs: 1, sleep,
        })).resolves.toEqual({ ready: false, reason: 'not_a_manifest' });
        expect(explorer.getAction).not.toHaveBeenCalled();
        expect(sleep).not.toHaveBeenCalled();
    });
});

describe('unreadable multipart link target', () => {
    it.each(['transaction', 'action'])('turns a thrown %s read into unreadable', async (read) => {
        const explorer = explorerOf({ transactions: [tx()] });
        explorer[read === 'transaction' ? 'getTransaction' : 'getAction']
            .mockRejectedValueOnce(new Error('offline'));
        await expect(resolveMultipartLinkTarget({
            explorer, txid: TXID, coin: 'BTC', maxAttempts: 5, waitMs: 1, sleep: vi.fn(),
        })).resolves.toEqual({ ready: false, reason: 'unreadable' });
    });

    it('rejects a complete status without the required manifest detail', async () => {
        const explorer = explorerOf({
            transactions: [tx()],
            details: [{ action: 'FILE', action_format: 1, status: 'valid', multipart: { status: 'complete' } }],
        });
        await expect(resolveMultipartLinkTarget({
            explorer, txid: TXID, coin: 'BTC', maxAttempts: 1, waitMs: 0, sleep: vi.fn(),
        })).resolves.toEqual({ ready: false, reason: 'unreadable' });
    });
});

describe('single-part FILE link target', () => {
    it('rejects a valid FILE without a multipart field', async () => {
        const explorer = explorerOf({
            transactions: [tx()],
            details: [{ action: 'FILE', action_format: 0, status: 'valid' }],
        });
        await expect(resolveMultipartLinkTarget({
            explorer, txid: TXID, coin: 'BTC', maxAttempts: 1, waitMs: 0, sleep: vi.fn(),
        })).resolves.toEqual({ ready: false, reason: 'not_a_manifest' });
    });
});
