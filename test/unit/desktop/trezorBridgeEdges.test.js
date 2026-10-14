// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@xchain-wallet/core/signerFactories', () => ({
    makeTrezorFactory: vi.fn(),
}));

const {
    getTrezorConnect,
    resetTrezorConnect,
} = await import('../../../packages/desktop/renderer/signerFactories/trezorFactory.js');

function emitMessage(source, data) {
    const event = new Event('message');
    Object.defineProperties(event, {
        source: { value: source },
        data: { value: data },
    });
    window.dispatchEvent(event);
}

function openBridge() {
    const bridgeWindow = {
        closed: false,
        postMessage: vi.fn(),
        close: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(bridgeWindow);
    return bridgeWindow;
}

async function connectBridge(bridgeWindow) {
    const connection = getTrezorConnect();
    emitMessage(bridgeWindow, { type: 'xchain-trezor-bridge-ready' });
    await vi.waitFor(() => expect(bridgeWindow.postMessage).toHaveBeenCalledOnce());
    const init = bridgeWindow.postMessage.mock.calls[0][0];
    emitMessage(bridgeWindow, { id: init.id, ok: true, result: undefined });
    return connection;
}

beforeEach(() => {
    resetTrezorConnect();
});

afterEach(() => {
    resetTrezorConnect();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('desktop Trezor bridge edges', () => {
    it('ignores ready messages from any window except the isolated bridge', async () => {
        const bridgeWindow = openBridge();
        const connection = getTrezorConnect();

        emitMessage({}, { type: 'xchain-trezor-bridge-ready' });
        emitMessage(bridgeWindow, { type: 'unrelated' });
        await Promise.resolve();
        expect(bridgeWindow.postMessage).not.toHaveBeenCalled();

        emitMessage(bridgeWindow, { type: 'xchain-trezor-bridge-ready' });
        await vi.waitFor(() => expect(bridgeWindow.postMessage).toHaveBeenCalledOnce());
        const init = bridgeWindow.postMessage.mock.calls[0][0];
        emitMessage(bridgeWindow, { id: init.id, ok: true, result: undefined });
        await expect(connection).resolves.toBeTruthy();
    });

    it('surfaces a bridge refusal and its constant fallback message', async () => {
        const bridgeWindow = openBridge();
        const connection = getTrezorConnect();
        emitMessage(bridgeWindow, { type: 'xchain-trezor-bridge-ready' });
        await vi.waitFor(() => expect(bridgeWindow.postMessage).toHaveBeenCalledOnce());
        const init = bridgeWindow.postMessage.mock.calls[0][0];

        emitMessage(bridgeWindow, { id: 'unknown', ok: false, error: 'ignore me' });
        emitMessage(bridgeWindow, { id: init.id, ok: false });

        await expect(connection).rejects.toThrow('desktop trezorFactory: bridge call failed');
    });

    it('refuses proxy calls after the bridge window is lost', async () => {
        const bridgeWindow = openBridge();
        const connect = await connectBridge(bridgeWindow);
        bridgeWindow.closed = true;

        await expect(connect.signMessage({ path: "m/84'/0'/0'", message: 'exact message' }))
            .rejects.toThrow('bridge window is not open');
        expect(bridgeWindow.postMessage).toHaveBeenCalledTimes(1);
    });

    it('rejects pending bridge work on reset even when closing the window throws', async () => {
        const bridgeWindow = openBridge();
        bridgeWindow.close.mockImplementation(() => { throw new Error('already gone'); });
        const connection = getTrezorConnect();
        emitMessage(bridgeWindow, { type: 'xchain-trezor-bridge-ready' });
        await vi.waitFor(() => expect(bridgeWindow.postMessage).toHaveBeenCalledOnce());
        const rejection = expect(connection).rejects.toThrow('Trezor Connect bridge was reset');

        expect(() => resetTrezorConnect()).not.toThrow();
        await rejection;
    });

    it('refuses the production bridge outside a renderer realm', async () => {
        vi.stubGlobal('window', undefined);

        await expect(getTrezorConnect()).rejects.toThrow('no window available');
    });
});
