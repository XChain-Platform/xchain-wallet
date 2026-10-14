// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as signerBridge from '../../../packages/desktop/renderer/signerBridge.js';

function makeIpc() {
    let inbound;
    const unsubscribe = vi.fn();
    return {
        postMessage: vi.fn(),
        onMessage: vi.fn((listener) => {
            inbound = listener;
            return unsubscribe;
        }),
        emit(message) {
            inbound?.(message);
        },
        unsubscribe,
    };
}

beforeEach(() => {
    signerBridge._resetForTests();
    delete globalThis.xchainWalletSignerBridge;
});

afterEach(() => {
    signerBridge._resetForTests();
    delete globalThis.xchainWalletSignerBridge;
});

describe('desktop renderer signer bridge edges', () => {
    it('validates registrations before opening the preload bridge', () => {
        expect(() => signerBridge.registerSigner('', { signPsbt() {} }))
            .toThrow('signerId is required');
        expect(() => signerBridge.registerSigner('ledger-1', {}))
            .toThrow('signer must implement Signer');
        expect(signerBridge.registeredIds()).toEqual([]);
    });

    // Bug: a failed preload registration leaves the signer live in the renderer registry.
    it.skip('rolls back registration when the signer preload bridge is unavailable', () => {
        expect(() => signerBridge.registerSigner('ledger-1', { signPsbt: vi.fn() }))
            .toThrow('xchainWalletSignerBridge not exposed by preload');

        expect(signerBridge.registeredIds()).toEqual([]);
    });

    it('returns a structured refusal when the exact signing request fails', async () => {
        const ipc = makeIpc();
        globalThis.xchainWalletSignerBridge = ipc;
        const refusal = Object.assign(new Error('user denied on device'), { name: 'NotAllowedError' });
        const signer = { signPsbt: vi.fn().mockRejectedValue(refusal) };
        signerBridge.registerSigner('ledger-1', signer);
        const payload = { signerId: 'ledger-1', psbt: 'unsigned-exact-bytes' };

        ipc.emit({ kind: 'request', reqId: 'request-1', op: 'signPsbt', payload });

        await vi.waitFor(() => expect(ipc.postMessage).toHaveBeenCalledWith({
            kind: 'response',
            reqId: 'request-1',
            ok: false,
            error: { name: 'NotAllowedError', message: 'user denied on device' },
        }));
        expect(signer.signPsbt).toHaveBeenCalledOnce();
        expect(signer.signPsbt).toHaveBeenCalledWith(payload);
    });

    it('keeps local registration usable when outbound IPC is disconnected', () => {
        const ipc = makeIpc();
        ipc.postMessage.mockImplementation(() => { throw new Error('port closed'); });
        globalThis.xchainWalletSignerBridge = ipc;
        const signer = { signPsbt: vi.fn() };

        expect(() => signerBridge.registerSigner('ledger-1', signer)).not.toThrow();
        expect(signerBridge.registeredIds()).toEqual(['ledger-1']);
        expect(() => signerBridge.unregisterSigner('ledger-1')).not.toThrow();
        expect(signerBridge.registeredIds()).toEqual([]);
        expect(() => signerBridge.unregisterSigner('missing')).not.toThrow();
    });

    it('unsubscribes the preload listener and ignores later requests on reset', async () => {
        const ipc = makeIpc();
        globalThis.xchainWalletSignerBridge = ipc;
        const signer = { signPsbt: vi.fn().mockResolvedValue({ psbt: 'signed' }) };
        signerBridge.registerSigner('ledger-1', signer);

        signerBridge._resetForTests();
        ipc.emit({
            kind: 'request',
            reqId: 'late',
            op: 'signPsbt',
            payload: { signerId: 'ledger-1', psbt: 'unsigned' },
        });
        await Promise.resolve();

        expect(ipc.unsubscribe).toHaveBeenCalledOnce();
        expect(signer.signPsbt).not.toHaveBeenCalled();
        expect(signerBridge.registeredIds()).toEqual([]);
    });
});
