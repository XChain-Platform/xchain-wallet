// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as signerBridge from '../../../packages/extension/src/popup/signerBridge.js';

function makeEvent() {
    const listeners = new Set();
    return {
        addListener: vi.fn((listener) => listeners.add(listener)),
        removeListener: vi.fn((listener) => listeners.delete(listener)),
        emit(message) {
            for (const listener of listeners) listener(message);
        },
    };
}

function makeChromePort() {
    return {
        onMessage: makeEvent(),
        onDisconnect: makeEvent(),
        postMessage: vi.fn(),
    };
}

let port;
let connect;

beforeEach(() => {
    port = makeChromePort();
    connect = vi.fn(() => port);
    vi.stubGlobal('chrome', { runtime: { connect } });
});

afterEach(() => {
    signerBridge._resetForTests();
    vi.unstubAllGlobals();
});

describe('popup signer bridge', () => {
    it('validates registrations before opening a Chrome runtime port', () => {
        expect(() => signerBridge.registerSigner('', { signPsbt() {} }))
            .toThrow('signerId is required');
        expect(() => signerBridge.registerSigner('ledger-1', {}))
            .toThrow('signer must implement Signer');
        expect(connect).not.toHaveBeenCalled();
    });

    it('registers a signer and serves background sign requests over the port', async () => {
        const signer = {
            signPsbt: vi.fn().mockResolvedValue({ psbt: 'signed' }),
        };

        signerBridge.registerSigner('ledger-1', signer);

        expect(connect).toHaveBeenCalledWith({ name: 'signer-bridge' });
        expect(signerBridge.registeredIds()).toEqual(['ledger-1']);
        expect(port.postMessage).toHaveBeenCalledWith({
            kind: 'register',
            signerIds: ['ledger-1'],
        });

        port.onMessage.emit({
            kind: 'request',
            reqId: 'request-1',
            op: 'signPsbt',
            payload: { signerId: 'ledger-1', psbt: 'unsigned' },
        });
        await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({
            kind: 'response',
            reqId: 'request-1',
            ok: true,
            result: { psbt: 'signed' },
        }));
        expect(signer.signPsbt).toHaveBeenCalledWith({
            signerId: 'ledger-1',
            psbt: 'unsigned',
        });
    });

    it('unregisters signers and reconnects after the Chrome port disconnects', () => {
        const signer = { signPsbt: vi.fn() };
        signerBridge.registerSigner('ledger-1', signer);

        signerBridge.unregisterSigner('ledger-1');
        expect(signerBridge.registeredIds()).toEqual([]);
        expect(port.postMessage).toHaveBeenCalledWith({
            kind: 'unregister',
            signerIds: ['ledger-1'],
        });

        port.onDisconnect.emit();
        const replacementPort = makeChromePort();
        connect.mockReturnValue(replacementPort);
        signerBridge.registerSigner('ledger-2', signer);

        expect(connect).toHaveBeenCalledTimes(2);
        expect(replacementPort.postMessage).toHaveBeenCalledWith({
            kind: 'register',
            signerIds: ['ledger-2'],
        });
    });
});
