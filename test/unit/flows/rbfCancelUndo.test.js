// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §37.2 / Cluster D FOLLOWUP 3: undoing an RBF cancel.
//
// The whole point of these helpers is one mapping that is easy to get
// backwards and expensive when you do: the undo replaces the CANCEL
// transaction (it is the one holding the UTXOs in the mempool now) and
// re-issues the ORIGINAL spend. Building the request the natural way -
// "originalTxHash is the original tx, like every other strategy" -
// produces a request that asks a node to replace a transaction with
// itself: a burned fee bump that moves no coins.
//
// Regtest only in spirit and in fact: nothing here touches a node, and
// the fixture chain id is a regtest one.

import { describe, it, expect, vi } from 'vitest';
import {
    sendRbfRequest,
    cancelUndoSnapshot,
    isCancelUndoable,
    buildCancelUndo,
    undoCancel,
    RbfNotSupportedError,
    RbfInvalidEntryError,
} from '../../../packages/core/src/flows/rbfReplace.js';

const CHAIN = 'bitcoin-regtest';
const ORIGINAL = 'aa'.repeat(32);
const CANCEL = 'bb'.repeat(32);
const RESTORE = 'cc'.repeat(32);

const entry = (over = {}) => ({
    chainId: CHAIN, txHash: ORIGINAL, blockIndex: 0, action: 'SEND', ...over,
});
const cancelResult = (over = {}) => ({
    replacementTxHash: CANCEL, broadcastedAt: '2026-09-09T00:00:00.000Z', ...over,
});

describe('cancelUndoSnapshot decides whether an Undo is offerable at all', () => {
    it('captures both hashes plus the chain and wallet', () => {
        expect(cancelUndoSnapshot({ entry: entry(), result: cancelResult(), walletId: 'w1' })).toEqual({
            chainId: CHAIN, originalTxHash: ORIGINAL, cancelTxHash: CANCEL, walletId: 'w1',
        });
    });

    it.each([
        ['no result', { entry: entry(), result: null }],
        ['result without a replacement hash', { entry: entry(), result: { broadcastedAt: 'x' } }],
        ['entry without a tx hash', { entry: entry({ txHash: undefined }), result: cancelResult() }],
        ['entry without a chain id', { entry: entry({ chainId: '' }), result: cancelResult() }],
        // A host that echoed the original hash back never broadcast a
        // replacement; a restore built from it would replace a tx with itself.
        ['a replacement hash equal to the original', {
            entry: entry(), result: cancelResult({ replacementTxHash: ORIGINAL }),
        }],
    ])('returns null for %s', (_name, opts) => {
        expect(cancelUndoSnapshot(opts)).toBe(null);
    });
});

describe('buildCancelUndo maps the two hashes to the roles the engine expects', () => {
    it('replaces the cancel and re-issues the original, never the reverse', () => {
        const snapshot = cancelUndoSnapshot({ entry: entry(), result: cancelResult(), walletId: 'w1' });
        const req = buildCancelUndo({ snapshot, feeRate: '20' });
        expect(req.strategy).toBe('restore');
        // The tx being replaced is the cancel, because that is what is
        // in the mempool. This is the assertion that fails if someone
        // "simplifies" the mapping back to the original hash.
        expect(req.originalTxHash).toBe(CANCEL);
        expect(req.restoreTxHash).toBe(ORIGINAL);
        expect(req.chainId).toBe(CHAIN);
        expect(req.walletId).toBe('w1');
        expect(req.feeRate).toBe('20');
    });

    it('throws without a snapshot rather than sending a half-built request', () => {
        expect(() => buildCancelUndo({})).toThrow(RbfInvalidEntryError);
    });
});

describe('isCancelUndoable withdraws the offer once the cancel confirms', () => {
    const snapshot = { chainId: CHAIN, originalTxHash: ORIGINAL, cancelTxHash: CANCEL };

    it('is undoable while the cancel is still in the mempool', () => {
        expect(isCancelUndoable({ snapshot, cancelBlockIndex: 0 })).toEqual({ ok: true });
        expect(isCancelUndoable({ snapshot, cancelBlockIndex: null })).toEqual({ ok: true });
    });

    it('is not undoable once the cancel is mined', () => {
        const v = isCancelUndoable({ snapshot, cancelBlockIndex: 900123 });
        expect(v.ok).toBe(false);
        expect(v.reason).toMatch(/already confirmed/i);
    });

    it('is not undoable without a snapshot', () => {
        expect(isCancelUndoable({ snapshot: null }).ok).toBe(false);
    });
});

describe('undoCancel sends the restore request through the shell', () => {
    it('hands the engine exactly the request buildCancelUndo assembled', async () => {
        const replaceTx = vi.fn(async () => ({ replacementTxHash: RESTORE, broadcastedAt: 'now' }));
        const snapshot = cancelUndoSnapshot({ entry: entry(), result: cancelResult(), walletId: 'w1' });

        const res = await undoCancel({ messaging: { replaceTx }, snapshot, cancelBlockIndex: 0 });

        expect(res.replacementTxHash).toBe(RESTORE);
        expect(replaceTx).toHaveBeenCalledTimes(1);
        expect(replaceTx.mock.calls[0][0]).toMatchObject({
            chainId: CHAIN, originalTxHash: CANCEL, strategy: 'restore', restoreTxHash: ORIGINAL,
        });
    });

    it('does not reach the network when the cancel already confirmed', async () => {
        const replaceTx = vi.fn();
        const snapshot = cancelUndoSnapshot({ entry: entry(), result: cancelResult() });
        await expect(undoCancel({ messaging: { replaceTx }, snapshot, cancelBlockIndex: 5 }))
            .rejects.toThrow(RbfInvalidEntryError);
        expect(replaceTx).not.toHaveBeenCalled();
    });

    it('surfaces the honest not-supported error on a shell without the engine', async () => {
        const snapshot = cancelUndoSnapshot({ entry: entry(), result: cancelResult() });
        await expect(undoCancel({ messaging: {}, snapshot, cancelBlockIndex: 0 }))
            .rejects.toThrow(RbfNotSupportedError);
    });
});

describe('sendRbfRequest validates the restore strategy', () => {
    const base = { chainId: CHAIN, originalTxHash: CANCEL, strategy: 'restore' };
    const messaging = () => ({ replaceTx: vi.fn(async () => ({ replacementTxHash: RESTORE })) });

    it('accepts restore when the two hashes differ', async () => {
        const m = messaging();
        await sendRbfRequest({ messaging: m, request: { ...base, restoreTxHash: ORIGINAL } });
        expect(m.replaceTx).toHaveBeenCalledTimes(1);
    });

    it('rejects restore with no restoreTxHash', async () => {
        const m = messaging();
        await expect(sendRbfRequest({ messaging: m, request: base }))
            .rejects.toThrow(/restoreTxHash is required/);
        expect(m.replaceTx).not.toHaveBeenCalled();
    });

    it('rejects a self-replacement instead of forwarding a fee-burning no-op', async () => {
        const m = messaging();
        await expect(sendRbfRequest({
            messaging: m,
            request: { ...base, originalTxHash: ORIGINAL, restoreTxHash: ORIGINAL },
        })).rejects.toThrow(/must differ/);
        expect(m.replaceTx).not.toHaveBeenCalled();
    });

    it('still rejects an unknown strategy', async () => {
        const m = messaging();
        await expect(sendRbfRequest({ messaging: m, request: { ...base, strategy: 'reissue' } }))
            .rejects.toThrow(/unknown strategy/);
    });

    it('leaves speedup and cancel untouched: neither needs a restoreTxHash', async () => {
        for (const strategy of ['speedup', 'cancel']) {
            const m = messaging();
            await sendRbfRequest({
                messaging: m,
                request: { chainId: CHAIN, originalTxHash: ORIGINAL, strategy },
            });
            expect(m.replaceTx).toHaveBeenCalledTimes(1);
        }
    });
});
