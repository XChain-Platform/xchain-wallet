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

    it('proxies only the Connect method surface through the preload relay', async () => {
        const call = vi.fn(async () => ({ ok: true, result: { success: true, payload: { address: 'bc1qexample' } } }));
        window.xchainWalletTrezorBridge = { call, close: vi.fn() };
        const open = vi.spyOn(window, 'open');

        const connect = await getTrezorConnect();
        expect(Object.keys(connect).sort()).toEqual([
            'getAddress',
            'getFeatures',
            'getPublicKey',
            'signMessage',
            'signTransaction',
        ]);
        expect(call).not.toHaveBeenCalled();

        await expect(connect.getAddress({ path: "m/84'/0'/0'/0/0" })).resolves.toEqual({
            success: true,
            payload: { address: 'bc1qexample' },
        });
        expect(call).toHaveBeenCalledExactlyOnceWith('getAddress', { path: "m/84'/0'/0'/0/0" });
        expect(open).not.toHaveBeenCalled();
        delete window.xchainWalletTrezorBridge;
    });

    it('keeps the injected-loader manifest equal to the bridge window\'s', async () => {
        const { TREZOR_CONNECT_MANIFEST } = await import('../../../packages/desktop/main/trezorBridgeWindow.js');
        const connect = { init: vi.fn().mockResolvedValue(undefined) };
        await getTrezorConnect(async () => connect);
        expect(connect.init.mock.calls[0][0].manifest).toEqual({ ...TREZOR_CONNECT_MANIFEST });
    });
});
