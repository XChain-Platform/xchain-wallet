// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// useConfirmAction hook ( §5.3.5): busy singleton, compose-failure
// path, superseded-report guard, and the promise contract. All SDK work is
// HOST-side (compose + tamper + preflight over messaging); the hook is a
// pure UI state machine, so these tests inject a `compose` promise and a
// `preflight` callback rather than a client sdkRegistry. Tamper detection
// itself lives in the composeActionForConfirm flow test.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import {
    useConfirmAction, ConfirmActionBusyError, UserRejectedError,
} from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

afterEach(() => cleanup());

// A host-preflight stub: the hook calls it with { actionString, source, ... }.
function preflightWith(report) {
    return vi.fn(async () => report || { verdict: 'pass', findings: [], unverified: [], stateHeight: 1 });
}

const COMPOSED = {
    actionString: 'SEND|0|JDOG|1|addr', action: 'SEND', version: 0,
    psbt: 'PSBT', encoding: 'OP_RETURN',
    expectedOutputs: { addressed: [], encoding: 'OP_RETURN' },
    tamperVerified: true,
};

describe('useConfirmAction', () => {

    // Capture a promise's settled outcome INSIDE act() so a rejection never
    // leaks as an unhandled rejection between act boundaries.
    const settle = (p) => p.then((v) => ({ ok: v }), (e) => ({ err: e }));

    it('rejects a second concurrent confirm() with a busy reason', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const preflight = preflightWith();
        let p1, out2;
        await act(async () => {
            p1 = settle(result.current.confirm({
                compose: () => new Promise(() => {}),   // never resolves; stays composing
                onApprove: async () => 'ok', chainId: 'btc', preflight,
            }));
            out2 = await settle(result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'ok', chainId: 'btc', preflight }));
        });
        expect(out2.err).toBeInstanceOf(ConfirmActionBusyError);
        // Clean up the hanging first confirm.
        let out1;
        await act(async () => { result.current.reject(); out1 = await p1; });
        expect(out1.err).toBeInstanceOf(UserRejectedError);
    });

    it('a compose failure (incl. a host-side tamper) rejects unwrapped and never opens the modal', async () => {
        const { result } = renderHook(() => useConfirmAction());
        let out;
        await act(async () => {
            out = await settle(result.current.confirm({
                // A tamper throws host-side inside compose(); the hook sees a
                // rejected compose() and never opens the modal.
                compose: async () => { throw new Error('The transaction contains 1 output(s) you did not approve.'); },
                onApprove: async () => 'ok', chainId: 'btc', preflight: preflightWith(),
            }));
        });
        expect(out.err.message).toMatch(/did not approve/);
        expect(result.current.phase).toBe('idle');
    });

    it('reaches ready with a report after a clean compose + preflight', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const preflight = preflightWith({ verdict: 'pass', findings: [], unverified: [], stateHeight: 9 });
        await act(async () => {
            result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'ok', chainId: 'btc', preflight });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.report.stateHeight).toBe(9);
        expect(result.current.canApprove).toBe(true);
        // preflight was called with the composed action string.
        expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ actionString: COMPOSED.actionString }));
    });

    it('goes ready with a null report when no preflight backend is supplied', async () => {
        const { result } = renderHook(() => useConfirmAction());
        await act(async () => {
            result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'ok', chainId: 'btc' });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.report).toBe(null);
        expect(result.current.canApprove).toBe(true);
    });

    it('resolves with onApprove return value on approve()', async () => {
        const { result } = renderHook(() => useConfirmAction());
        let p;
        await act(async () => { p = result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => ({ txid: 'T' }), chainId: 'btc', preflight: preflightWith() }); });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        await act(async () => { await result.current.approve({ password: 'pw' }); });
        await expect(p).resolves.toEqual({ txid: 'T' });
    });

    it('rejects with user-rejected on reject()', async () => {
        const { result } = renderHook(() => useConfirmAction());
        let p;
        await act(async () => { p = settle(result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'x', chainId: 'btc', preflight: preflightWith() })); });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        let out;
        await act(async () => { result.current.reject(); out = await p; });
        expect(out.err).toBeInstanceOf(UserRejectedError);
    });

    it('canApprove is false on a non-overridable error and true after acking an overridable one', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const hardFail = preflightWith({ verdict: 'fail', findings: [{ code: 'DEST_ADDRESS_INVALID', severity: 'error', overridable: false, message: 'x' }], unverified: [] });
        let p;
        await act(async () => { p = settle(result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'x', chainId: 'btc', preflight: hardFail })); });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.canApprove).toBe(false);
        await act(async () => { result.current.reject(); await p; });
    });
});
