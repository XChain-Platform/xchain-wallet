// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// D18/C13/C29 regression. `useProofVerification`'s effect used to key on the
// `balances` object itself. Home hands the hook a NEW `balances` object on
// every `BALANCE_POLL_INTERVAL_MS` poll even when the addresses and tokens
// on it are unchanged, so the whole SPV proof fan-out (two explorer reads
// per (chain, address, token), under 60/min limiters) re-fired every poll.
// This pins the fix: the effect now keys on `proofJobsSignature`, a stable
// string of the job set, so a poll that changed nothing does not re-verify,
// while a token arriving still does.

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
    useActionProofVerification,
    useProofVerification,
} from '../../../packages/core/src/shared/hooks/useProofVerification.js';

function mountHook(messaging, initialProps) {
    return renderHook(
        ({ balances, enabled }) => useProofVerification({ messaging, balances, enabled }),
        { initialProps },
    );
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

describe('useProofVerification re-fire signature', () => {
    it('does not re-verify when a re-render hands down an equal balances object under a new identity', async () => {
        const verifyBalance = vi.fn(async () => ({ status: 'verified', reason: null, trust: 'explorer' }));
        const messaging = { verifyBalance };
        const balancesA = {
            'bitcoin-regtest': [{ address: 'a1', balances: { tokens: [{ tick: 'FOO' }] } }],
        };

        const { result, rerender } = mountHook(messaging, { balances: balancesA, enabled: true });
        await waitFor(() => expect(result.current['bitcoin-regtest:FOO']?.status).toBe('verified'));
        expect(verifyBalance).toHaveBeenCalledTimes(1);

        // Structurally equal, but a NEW object, the way Home's poll hands it down.
        const balancesAEqual = {
            'bitcoin-regtest': [{ address: 'a1', balances: { tokens: [{ tick: 'FOO' }] } }],
        };
        expect(balancesAEqual).not.toBe(balancesA);
        rerender({ balances: balancesAEqual, enabled: true });

        // Give any (wrongly re-fired) effect a tick to run, then confirm it did not.
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(verifyBalance).toHaveBeenCalledTimes(1);
    });

    it('re-verifies once a new token joins the job set, only for the added job', async () => {
        const verifyBalance = vi.fn(async () => ({ status: 'verified', reason: null, trust: 'explorer' }));
        const messaging = { verifyBalance };
        const balancesA = {
            'bitcoin-regtest': [{ address: 'a1', balances: { tokens: [{ tick: 'FOO' }] } }],
        };

        const { result, rerender } = mountHook(messaging, { balances: balancesA, enabled: true });
        await waitFor(() => expect(result.current['bitcoin-regtest:FOO']?.status).toBe('verified'));
        expect(verifyBalance).toHaveBeenCalledTimes(1);

        const balancesB = {
            'bitcoin-regtest': [{ address: 'a1', balances: { tokens: [{ tick: 'FOO' }, { tick: 'BAR' }] } }],
        };
        rerender({ balances: balancesB, enabled: true });

        await waitFor(() => expect(result.current['bitcoin-regtest:BAR']?.status).toBe('verified'));
        // The set changed (BAR joined), so the effect re-fired and re-ran the
        // whole current job set; the call count grows by at least the one new
        // job (it is not required to remember FOO already verified).
        expect(verifyBalance.mock.calls.length).toBeGreaterThan(1);
        expect(verifyBalance).toHaveBeenCalledWith({ chainId: 'bitcoin-regtest', address: 'a1', tick: 'BAR' });
    });

    it('clears the map and never calls verifyBalance while disabled', async () => {
        const verifyBalance = vi.fn(async () => ({ status: 'verified', reason: null, trust: 'explorer' }));
        const messaging = { verifyBalance };
        const balancesA = {
            'bitcoin-regtest': [{ address: 'a1', balances: { tokens: [{ tick: 'FOO' }] } }],
        };

        const { result } = mountHook(messaging, { balances: balancesA, enabled: false });

        // No async work is queued while disabled; a microtask flush confirms it stayed empty.
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(result.current).toEqual({});
        expect(verifyBalance).not.toHaveBeenCalled();
    });
});

describe('useActionProofVerification', () => {
    const first = { key: 'first', chainId: 'bitcoin-regtest', actionIndex: 1 };
    const second = { key: 'second', chainId: 'bitcoin-regtest', actionIndex: 2 };
    const third = { key: 'third', chainId: 'litecoin-regtest', actionIndex: 3 };

    it('ignores item reordering and verifies again when the key set changes', async () => {
        const verifyAction = vi.fn(async () => ({
            status: 'verified',
            reason: null,
            trust: 'pinned',
        }));
        const messaging = { verifyAction };
        const { result, rerender } = renderHook(
            ({ items }) => useActionProofVerification({ messaging, items, enabled: true }),
            { initialProps: { items: [first, second] } },
        );

        await waitFor(() => expect(result.current.first?.status).toBe('verified'));
        await waitFor(() => expect(result.current.second?.status).toBe('verified'));
        expect(verifyAction).toHaveBeenCalledTimes(2);

        rerender({ items: [second, first] });
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(verifyAction).toHaveBeenCalledTimes(2);

        rerender({ items: [first, third] });
        await waitFor(() => expect(result.current.third?.status).toBe('verified'));
        expect(verifyAction).toHaveBeenCalledTimes(4);
        expect(verifyAction).toHaveBeenCalledWith({
            chainId: 'litecoin-regtest',
            actionIndex: 3,
        });
    });

    it('stops workers before queued items start after unmount', async () => {
        const pending = [];
        const verifyAction = vi.fn(() => {
            const request = deferred();
            pending.push(request);
            return request.promise;
        });
        const items = Array.from({ length: 7 }, (_, index) => ({
            key: `action-${index}`,
            chainId: 'bitcoin-regtest',
            actionIndex: index,
        }));
        const messaging = { verifyAction };
        const { unmount } = renderHook(() => useActionProofVerification({
            messaging,
            items,
            enabled: true,
        }));

        await waitFor(() => expect(verifyAction).toHaveBeenCalledTimes(6));
        unmount();
        await act(async () => {
            for (const request of pending) {
                request.resolve({ status: 'verified', reason: null, trust: 'explorer' });
            }
            await Promise.all(pending.map((request) => request.promise));
        });

        expect(verifyAction).toHaveBeenCalledTimes(6);
    });
});
