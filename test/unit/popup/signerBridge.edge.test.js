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
    };
}

function makePort(overrides = {}) {
    return {
        onMessage: makeEvent(),
        onDisconnect: makeEvent(),
        postMessage: vi.fn(),
        ...overrides,
    };
}

afterEach(() => {
    signerBridge._resetForTests();
    vi.unstubAllGlobals();
});

describe('popup signer bridge edge cases', () => {
    it('fails clearly when the extension runtime cannot open a port', () => {
        vi.stubGlobal('chrome', { runtime: {} });

        expect(() => signerBridge.registerSigner('ledger-1', { signPsbt: vi.fn() }))
            .toThrow('chrome.runtime.connect is not available');
    });

    it('reuses a live port for later signer registrations', () => {
        const port = makePort();
        const connect = vi.fn(() => port);
        vi.stubGlobal('chrome', { runtime: { connect } });
        const signer = { signPsbt: vi.fn() };

        signerBridge.registerSigner('ledger-1', signer);
        signerBridge.registerSigner('ledger-2', signer);

        expect(connect).toHaveBeenCalledOnce();
        expect(port.postMessage).toHaveBeenCalledWith({
            kind: 'register',
            signerIds: ['ledger-2'],
        });
    });

    it('ignores unregister requests for signers that are not live', () => {
        const port = makePort();
        const connect = vi.fn(() => port);
        vi.stubGlobal('chrome', { runtime: { connect } });
        signerBridge.registerSigner('ledger-1', { signPsbt: vi.fn() });
        port.postMessage.mockClear();

        signerBridge.unregisterSigner('missing');

        expect(port.postMessage).not.toHaveBeenCalled();
        expect(signerBridge.registeredIds()).toEqual(['ledger-1']);
    });

    it('removes a signer even when a disconnect makes unregister posting throw', () => {
        const port = makePort();
        const connect = vi.fn(() => port);
        vi.stubGlobal('chrome', { runtime: { connect } });
        signerBridge.registerSigner('ledger-1', { signPsbt: vi.fn() });
        port.postMessage.mockImplementation(() => { throw new Error('port disconnected'); });

        expect(() => signerBridge.unregisterSigner('ledger-1')).not.toThrow();
        expect(signerBridge.registeredIds()).toEqual([]);
    });

    it('supports ports that do not expose a disconnect event', () => {
        const port = makePort({ onDisconnect: undefined });
        vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });

        expect(() => signerBridge.registerSigner('ledger-1', { signPsbt: vi.fn() }))
            .not.toThrow();
        expect(signerBridge.registeredIds()).toEqual(['ledger-1']);
    });
});
