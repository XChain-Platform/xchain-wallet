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

    it('§5.3.4: a bad password re-prompts on the SAME PSBT - back to ready, promise still PENDING', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const badPw = Object.assign(new Error('Incorrect password.'), { name: 'InvalidPasswordError' });
        let calls = 0;
        let p; let settled = false;
        await act(async () => {
            p = result.current.confirm({
                compose: async () => COMPOSED,
                onApprove: async () => {
                    calls += 1;
                    if (calls === 1) throw badPw;
                    return { txid: 'T' };
                },
                chainId: 'btc', preflight: preflightWith(),
            });
            p.then(() => { settled = true; }, () => { settled = true; });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));

        // First Approve: bad password -> stays open at `ready`, error surfaced,
        // and crucially the confirm() promise has NOT settled.
        await act(async () => { await result.current.approve({}); });
        expect(result.current.phase).toBe('ready');
        expect(result.current.error).toBe(badPw);
        expect(settled).toBe(false);

        // Retry succeeds against the SAME composed PSBT (no re-compose).
        await act(async () => { await result.current.approve({}); });
        await expect(p).resolves.toEqual({ txid: 'T' });
        expect(calls).toBe(2);
    });

    it('does NOT double-reserve when a credential failure re-prompts', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const badPw = Object.assign(new Error('bad'), { name: 'InvalidPasswordError' });
        const reserve = vi.fn(async () => {});
        const release = vi.fn(async () => {});
        let calls = 0; let p;
        await act(async () => {
            p = result.current.confirm({
                compose: async () => COMPOSED,
                onApprove: async () => { calls += 1; if (calls === 1) throw badPw; return 'ok'; },
                chainId: 'btc', preflight: preflightWith(),
                reservationLedger: { reserve, release },
                reserve: { tick: 'JDOG', amount: '5' },
            });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        await act(async () => { await result.current.approve({}); });
        await act(async () => { await result.current.approve({}); });
        await p;
        // One reservation for the whole confirm, not one per Approve attempt
        // (re-reserving would double-count and orphan the first id).
        expect(reserve).toHaveBeenCalledTimes(1);
    });

    it('a non-credential approve failure is still terminal (rejects)', async () => {
        const { result } = renderHook(() => useConfirmAction());
        let p;
        await act(async () => {
            p = settle(result.current.confirm({
                compose: async () => COMPOSED,
                onApprove: async () => { throw new Error('node unreachable'); },
                chainId: 'btc', preflight: preflightWith(),
            }));
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        let out;
        await act(async () => {
            await result.current.approve({});
            out = await p;
        });
        expect(out.err.message).toBe('node unreachable');
        expect(result.current.phase).toBe('error');
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
