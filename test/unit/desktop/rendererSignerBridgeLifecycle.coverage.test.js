// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as signerBridge from '../../../packages/desktop/renderer/signerBridge.js';

function installIpc() {
    let receive;
    const ipc = {
        postMessage: vi.fn(),
        onMessage: vi.fn((listener) => {
            receive = listener;
            return vi.fn();
        }),
        emit: (message) => receive(message),
    };
    globalThis.xchainWalletSignerBridge = ipc;
    return ipc;
}

beforeEach(() => {
    signerBridge._resetForTests();
});

afterEach(() => {
    signerBridge._resetForTests();
    delete globalThis.xchainWalletSignerBridge;
});

describe('desktop renderer signer bridge lifecycle branches', () => {
    it('reuses one preload listener and refuses a request for an unknown signer', async () => {
        const ipc = installIpc();
        signerBridge.registerSigner('ledger-1', { signPsbt: vi.fn() });
        signerBridge.registerSigner('ledger-2', { signPsbt: vi.fn() });

        expect(ipc.onMessage).toHaveBeenCalledOnce();
        expect(signerBridge.registeredIds()).toEqual(['ledger-1', 'ledger-2']);

        ipc.emit({
            kind: 'request',
            reqId: 'missing-signer',
            op: 'signPsbt',
            payload: { signerId: 'missing', psbt: 'unsigned' },
        });

        await vi.waitFor(() => expect(ipc.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'response',
            reqId: 'missing-signer',
            ok: false,
        })));
    });
});
