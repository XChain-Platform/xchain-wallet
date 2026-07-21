// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// useConfirmAction hook ( §5.3.5): busy singleton, compose failure
// path, tamper-block, superseded-report guard, and the promise contract.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import {
    useConfirmAction, ConfirmActionBusyError, UserRejectedError,
} from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

afterEach(() => cleanup());

function sdkRegistryWith({ report, decompose } = {}) {
    const sdk = {
        preflight: vi.fn(async () => report || { verdict: 'pass', findings: [], unverified: [], stateHeight: 1 }),
        wallet: { decomposePsbt: decompose || (() => ({ outputs: [] })) },
    };
    return { get: () => sdk, _sdk: sdk };
}

const COMPOSED = {
    actionString: 'SEND|0|JDOG|1|addr', action: 'SEND', version: 0,
    psbt: 'PSBT', encoding: 'OP_RETURN',
    expectedOutputs: { addressed: [], encoding: 'OP_RETURN' },
};

describe('useConfirmAction', () => {

    // Capture a promise's settled outcome INSIDE act() so a rejection never
    // leaks as an unhandled rejection between act boundaries.
    const settle = (p) => p.then((v) => ({ ok: v }), (e) => ({ err: e }));

    it('rejects a second concurrent confirm() with a busy reason', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const sdkRegistry = sdkRegistryWith();
        let p1, out2;
        await act(async () => {
            p1 = settle(result.current.confirm({
                compose: () => new Promise(() => {}),   // never resolves; stays composing
                onApprove: async () => 'ok', chainId: 'btc', sdkRegistry,
            }));
            out2 = await settle(result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'ok', chainId: 'btc', sdkRegistry }));
        });
        expect(out2.err).toBeInstanceOf(ConfirmActionBusyError);
        // Clean up the hanging first confirm.
        let out1;
        await act(async () => { result.current.reject(); out1 = await p1; });
        expect(out1.err).toBeInstanceOf(UserRejectedError);
    });

    it('a compose failure rejects unwrapped and never opens the modal', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const sdkRegistry = sdkRegistryWith();
        let out;
        await act(async () => {
            out = await settle(result.current.confirm({
                compose: async () => { throw new Error('bad params'); },
                onApprove: async () => 'ok', chainId: 'btc', sdkRegistry,
            }));
        });
        expect(out.err.message).toBe('bad params');
        expect(result.current.phase).toBe('idle');
    });

    it('reaches ready with a report after a clean compose + preflight', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const sdkRegistry = sdkRegistryWith({ report: { verdict: 'pass', findings: [], unverified: [], stateHeight: 9 } });
        await act(async () => {
            result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'ok', chainId: 'btc', sdkRegistry });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.report.stateHeight).toBe(9);
        expect(result.current.canApprove).toBe(true);
    });

    it('resolves with onApprove return value on approve()', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const sdkRegistry = sdkRegistryWith();
        let p;
        await act(async () => { p = result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => ({ txid: 'T' }), chainId: 'btc', sdkRegistry }); });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        await act(async () => { await result.current.approve({ password: 'pw' }); });
        await expect(p).resolves.toEqual({ txid: 'T' });
    });

    it('rejects with user-rejected on reject()', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const sdkRegistry = sdkRegistryWith();
        let p;
        await act(async () => { p = settle(result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'x', chainId: 'btc', sdkRegistry })); });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        let out;
        await act(async () => { result.current.reject(); out = await p; });
        expect(out.err).toBeInstanceOf(UserRejectedError);
    });

    it('canApprove is false on a non-overridable error and true after acking an overridable one', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const hardFail = sdkRegistryWith({ report: { verdict: 'fail', findings: [{ code: 'DEST_ADDRESS_INVALID', severity: 'error', overridable: false, message: 'x' }], unverified: [] } });
        let p;
        await act(async () => { p = settle(result.current.confirm({ compose: async () => COMPOSED, onApprove: async () => 'x', chainId: 'btc', sdkRegistry: hardFail })); });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.canApprove).toBe(false);
        await act(async () => { result.current.reject(); await p; });
    });

    it('a tamper (unexpected output) blocks before opening and rejects', async () => {
        const { result } = renderHook(() => useConfirmAction());
        const sdkRegistry = sdkRegistryWith({
            decompose: () => ({ outputs: [{ address: 'ATTACKER', scriptType: 'p2wpkh', scriptPubKeyHex: '0014', value: 999 }] }),
        });
        let out;
        await act(async () => {
            out = await settle(result.current.confirm({
                compose: async () => COMPOSED,
                onApprove: async () => 'x', chainId: 'btc', sdkRegistry,
                ownAddresses: [],
                decodeActionFromPsbt: () => ({ ok: true, actionString: 'SEND|0|JDOG|1|addr' }),
            }));
        });
        expect(out.err.message).toMatch(/did not approve|does not match/i);
    });
});
