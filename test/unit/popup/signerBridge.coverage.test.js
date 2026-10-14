// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
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

function makePort() {
    return {
        onMessage: makeEvent(),
        onDisconnect: makeEvent(),
        postMessage: vi.fn(),
    };
}

afterEach(() => {
    signerBridge._resetForTests();
    vi.unstubAllGlobals();
});

describe('popup signer bridge unavailable states', () => {
    it('rejects a request for a missing signer', async () => {
        const port = makePort();
        vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });
        signerBridge.registerSigner('ledger-1', { signPsbt: vi.fn() });

        port.onMessage.emit({
            kind: 'request',
            reqId: 'missing-1',
            op: 'signPsbt',
            payload: { signerId: 'missing', psbt: 'unsigned' },
        });

        await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'response',
                reqId: 'missing-1',
                ok: false,
            }),
        ));
    });

    it('removes a live signer after its port disconnects', () => {
        const port = makePort();
        vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });
        signerBridge.registerSigner('ledger-1', { signPsbt: vi.fn() });
        port.postMessage.mockClear();

        port.onDisconnect.emit();
        signerBridge.unregisterSigner('ledger-1');

        expect(signerBridge.registeredIds()).toEqual([]);
        expect(port.postMessage).not.toHaveBeenCalled();
    });
});
