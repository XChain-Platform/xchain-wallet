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

beforeEach(() => {
    resetTrezorConnect();
});

afterEach(() => {
    vi.unstubAllGlobals();
    resetTrezorConnect();
    delete window.xchainWalletTrezorBridge;
    vi.restoreAllMocks();
});

describe('desktop Trezor bridge edges', () => {
    it('refuses the production bridge in a window with no relay world', async () => {
        await expect(getTrezorConnect()).rejects.toThrow('Trezor Connect bridge is not available in this window');
        window.xchainWalletTrezorBridge = {};
        await expect(getTrezorConnect()).rejects.toThrow('Trezor Connect bridge is not available in this window');
    });

    it('surfaces a relay refusal and its constant fallback message', async () => {
        window.xchainWalletTrezorBridge = { call: vi.fn(), close: vi.fn() };
        const proxy = await getTrezorConnect();

        window.xchainWalletTrezorBridge.call.mockResolvedValueOnce({ ok: false, error: 'Device disconnected' });
        await expect(proxy.getFeatures()).rejects.toThrow('Device disconnected');
        for (const reply of [{ ok: false }, { ok: false, error: '' }, null, undefined, { ok: 'true', result: 1 }]) {
            window.xchainWalletTrezorBridge.call.mockResolvedValueOnce(reply);
            await expect(proxy.getFeatures()).rejects.toThrow('desktop trezorFactory: bridge call failed');
        }
    });

    it('passes each proxy method and its argument to the relay unchanged', async () => {
        const call = vi.fn(async (method, args) => ({ ok: true, result: { method, args } }));
        window.xchainWalletTrezorBridge = { call, close: vi.fn() };
        const proxy = await getTrezorConnect();
        const args = { path: "m/84'/0'/0'", message: 'exact message' };
        await expect(proxy.signMessage(args)).resolves.toEqual({ method: 'signMessage', args });
        expect(call).toHaveBeenCalledExactlyOnceWith('signMessage', args);
    });

    it('does not throw on reset when the relay close rejects or throws', async () => {
        window.xchainWalletTrezorBridge = {
            call: vi.fn(),
            close: vi.fn(() => { throw new Error('already gone'); }),
        };
        await getTrezorConnect();
        expect(() => resetTrezorConnect()).not.toThrow();
        await vi.waitFor(() => expect(window.xchainWalletTrezorBridge.close).toHaveBeenCalledOnce());

        window.xchainWalletTrezorBridge.close = vi.fn(async () => { throw new Error('gone'); });
        expect(() => resetTrezorConnect()).not.toThrow();
        await vi.waitFor(() => expect(window.xchainWalletTrezorBridge.close).toHaveBeenCalledOnce());
    });

    it('refuses the production bridge outside a renderer realm', async () => {
        vi.stubGlobal('window', undefined);

        await expect(getTrezorConnect()).rejects.toThrow('not available in this window');
        expect(() => resetTrezorConnect()).not.toThrow();
    });
});
