// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Shells hold a wallet switch from another window while a review, or the
// result it ends on, is open. They hear each confirmation end through
// subscribeConfirmEnd: approved once Approve was pressed (a result is on
// screen), and left when the form unmounted.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import {
    isConfirmActive,
    subscribeConfirmEnd,
    useConfirmAction,
} from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

afterEach(() => cleanup());

const COMPOSED = {
    actionString: 'SEND|0|JDOG|1|addr', action: 'SEND', version: 0,
    psbt: 'PSBT', encoding: 'OP_RETURN',
    expectedOutputs: { addressed: [], encoding: 'OP_RETURN' },
    tamperVerified: true,
};
const preflight = async () => ({ verdict: 'pass', findings: [], unverified: [], stateHeight: 1 });
const settle = (p) => p.then((v) => ({ ok: v }), (e) => ({ err: e }));

async function readyReview(onApprove = async () => ({ txid: 'T' })) {
    const view = renderHook(() => useConfirmAction());
    let pending;
    await act(async () => {
        pending = settle(view.result.current.confirm({ compose: async () => COMPOSED, onApprove, chainId: 'btc', preflight }));
    });
    await waitFor(() => expect(view.result.current.phase).toBe('ready'));
    return { ...view, pending };
}

describe('confirm end signal', () => {
    it('reports a cancelled review as not approved and still mounted', async () => {
        const ends = vi.fn();
        const stop = subscribeConfirmEnd(ends);
        try {
            const { result, pending } = await readyReview();
            await act(async () => { result.current.reject(); await pending; });
            expect(ends).toHaveBeenCalledTimes(1);
            expect(ends).toHaveBeenCalledWith({ approved: false, left: false });
            expect(isConfirmActive()).toBe(false);
        } finally { stop(); }
    });

    it('reports an approved review as approved, with its result on screen', async () => {
        const ends = vi.fn();
        const stop = subscribeConfirmEnd(ends);
        try {
            const { result, pending } = await readyReview();
            await act(async () => { await result.current.approve({ password: 'pw' }); await pending; });
            expect(ends).toHaveBeenCalledWith({ approved: true, left: false });
            expect(isConfirmActive()).toBe(false);
        } finally { stop(); }
    });

    it('reports a review left by navigation as left', async () => {
        const ends = vi.fn();
        const stop = subscribeConfirmEnd(ends);
        try {
            const { unmount, pending } = await readyReview();
            await act(async () => { unmount(); await pending; });
            expect(ends).toHaveBeenCalledWith({ approved: false, left: true });
        } finally { stop(); }
    });

    it('reports an approval still in flight when the form unmounts as approved and left', async () => {
        const ends = vi.fn();
        const stop = subscribeConfirmEnd(ends);
        try {
            const signing = new Promise(() => {});
            const { result, unmount } = await readyReview(() => signing);
            await act(async () => { result.current.approve({}); });
            await act(async () => { unmount(); });
            expect(ends).toHaveBeenCalledWith({ approved: true, left: true });
            expect(isConfirmActive()).toBe(false);
        } finally { stop(); }
    });

    it('stops telling a listener once it unsubscribes', async () => {
        const ends = vi.fn();
        subscribeConfirmEnd(ends)();
        const { result, pending } = await readyReview();
        await act(async () => { result.current.reject(); await pending; });
        expect(ends).not.toHaveBeenCalled();
    });
});
