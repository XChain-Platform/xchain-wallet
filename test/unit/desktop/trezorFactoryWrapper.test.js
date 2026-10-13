// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { makeTrezorFactory } = vi.hoisted(() => ({
    makeTrezorFactory: vi.fn(),
}));

vi.mock('@xchain-wallet/core/signerFactories', () => ({ makeTrezorFactory }));

const {
    getTrezorConnect,
    pairTrezorSigner,
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

beforeEach(() => {
    resetTrezorConnect();
    makeTrezorFactory.mockReset();
});

afterEach(() => {
    resetTrezorConnect();
    vi.restoreAllMocks();
});

describe('desktop Trezor factory wrapper', () => {
    it('initializes and caches a default-exported injected Connect object', async () => {
        const connect = { init: vi.fn().mockResolvedValue(undefined) };
        const loader = vi.fn().mockResolvedValue({ default: connect });

        await expect(getTrezorConnect(loader)).resolves.toBe(connect);
        await expect(getTrezorConnect(loader)).resolves.toBe(connect);

        expect(loader).toHaveBeenCalledOnce();
        expect(connect.init).toHaveBeenCalledOnce();
        expect(connect.init).toHaveBeenCalledWith({
            manifest: {
                email: 'support@xchain.io',
                appUrl: 'https://xchain.io/wallet',
            },
            lazyLoad: true,
        });
    });

    it('rejects an injected module without an init method', async () => {
        await expect(getTrezorConnect(async () => ({ default: {} })))
            .rejects.toThrow('does not look like Trezor Connect');
    });

    it('binds the injected loader into the core pairing factory', async () => {
        const connect = { init: vi.fn().mockResolvedValue(undefined) };
        const loader = vi.fn().mockResolvedValue(connect);
        const pairResult = { signer: { vendor: 'trezor' } };
        const pair = vi.fn().mockResolvedValue(pairResult);
        makeTrezorFactory.mockReturnValue(pair);

        await expect(pairTrezorSigner({ loader })).resolves.toBe(pairResult);

        const options = makeTrezorFactory.mock.calls[0][0];
        await expect(options.getConnect()).resolves.toBe(connect);
        expect(pair).toHaveBeenCalledOnce();
    });

    it('opens the isolated bridge and proxies only the Connect method surface', async () => {
        const bridgeWindow = {
            closed: false,
            postMessage: vi.fn(),
            close: vi.fn(),
        };
        const open = vi.spyOn(window, 'open').mockReturnValue(bridgeWindow);

        const connectPromise = getTrezorConnect();
        expect(open).toHaveBeenCalledOnce();
        const [dataUrl, windowName] = open.mock.calls[0];
        expect(windowName).toBe('xchain-trezor-connect-bridge');
        expect(dataUrl).toMatch(/^data:text\/html;base64,/);

        emitMessage(bridgeWindow, { type: 'xchain-trezor-bridge-ready' });
        await vi.waitFor(() => expect(bridgeWindow.postMessage).toHaveBeenCalledOnce());
        const initRequest = bridgeWindow.postMessage.mock.calls[0][0];
        expect(initRequest).toMatchObject({ method: 'init', args: { lazyLoad: true } });
        emitMessage(bridgeWindow, { id: initRequest.id, ok: true, result: undefined });

        const connect = await connectPromise;
        expect(Object.keys(connect).sort()).toEqual([
            'getAddress',
            'getFeatures',
            'getPublicKey',
            'signMessage',
            'signTransaction',
        ]);

        const addressPromise = connect.getAddress({ path: "m/84'/0'/0'/0/0" });
        const addressRequest = bridgeWindow.postMessage.mock.calls.at(-1)[0];
        expect(addressRequest).toMatchObject({
            method: 'getAddress',
            args: { path: "m/84'/0'/0'/0/0" },
        });
        emitMessage(bridgeWindow, {
            id: addressRequest.id,
            ok: true,
            result: { success: true, payload: { address: 'bc1qexample' } },
        });
        await expect(addressPromise).resolves.toEqual({
            success: true,
            payload: { address: 'bc1qexample' },
        });
    });

    it('reports a refused bridge window', async () => {
        vi.spyOn(window, 'open').mockReturnValue(null);

        await expect(getTrezorConnect()).rejects.toThrow('bridge window was refused');
    });

    it('removes bridge message listeners when the bridge is reset', async () => {
        const addEventListener = vi.spyOn(window, 'addEventListener');
        const removeEventListener = vi.spyOn(window, 'removeEventListener');
        const bridgeWindow = {
            closed: false,
            postMessage: vi.fn(),
            close: vi.fn(),
        };
        vi.spyOn(window, 'open').mockReturnValue(bridgeWindow);

        const connectPromise = getTrezorConnect();
        const listeners = addEventListener.mock.calls
            .filter(([type]) => type === 'message')
            .map(([, listener]) => listener);
        expect(listeners).toHaveLength(2);

        emitMessage(bridgeWindow, { type: 'xchain-trezor-bridge-ready' });
        await vi.waitFor(() => expect(bridgeWindow.postMessage).toHaveBeenCalledOnce());
        const initRequest = bridgeWindow.postMessage.mock.calls[0][0];
        emitMessage(bridgeWindow, { id: initRequest.id, ok: true, result: undefined });
        await connectPromise;

        resetTrezorConnect();

        for (const listener of listeners) {
            expect(removeEventListener).toHaveBeenCalledWith('message', listener);
        }
    });
});
