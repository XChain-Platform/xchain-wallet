// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    hydrateEnvelopeError: vi.fn(),
    invalidateTokenInfoForAction: vi.fn(),
}));

vi.mock('@xchain-wallet/core/shared/utils/tokenInfoCache.js', () => ({
    invalidateTokenInfoForAction: mocks.invalidateTokenInfoForAction,
}));
vi.mock('@xchain-wallet/extension/src/background/MessageHost.js', () => ({
    hydrateEnvelopeError: mocks.hydrateEnvelopeError,
}));

const { sendMessage } = await import('../../../packages/desktop/renderer/bridgeMessaging.js');

beforeEach(() => {
    mocks.hydrateEnvelopeError.mockReset();
    mocks.invalidateTokenInfoForAction.mockReset();
    delete globalThis.xchainWalletBridge;
});

afterEach(() => {
    delete globalThis.xchainWalletBridge;
});

describe('desktop renderer message envelope edges', () => {
    it('refuses missing and incomplete preload bridges', async () => {
        await expect(sendMessage('session.status')).rejects.toThrow('xchainWalletBridge not exposed');

        globalThis.xchainWalletBridge = {};
        await expect(sendMessage('session.status')).rejects.toThrow('xchainWalletBridge not exposed');
    });

    it.each([undefined, null, false, 'lost'])('refuses a non-envelope response: %s', async (response) => {
        globalThis.xchainWalletBridge = { sendMessage: vi.fn().mockResolvedValue(response) };

        await expect(sendMessage('wallet.list')).rejects.toThrow('no response for "wallet.list"');
    });

    it('returns successful results and invalidates only action requests', async () => {
        const bridge = vi.fn()
            .mockResolvedValueOnce({ ok: true, result: { txid: 'abc' } })
            .mockResolvedValueOnce({ ok: true, result: [] });
        globalThis.xchainWalletBridge = { sendMessage: bridge };
        const request = { chainId: 'bitcoin-mainnet', action: 'SEND', params: { tick: 'BTC' } };

        await expect(sendMessage('action.send', request)).resolves.toEqual({ txid: 'abc' });
        await expect(sendMessage('wallet.list')).resolves.toEqual([]);

        expect(bridge).toHaveBeenNthCalledWith(1, { type: 'action.send', request });
        expect(mocks.invalidateTokenInfoForAction).toHaveBeenCalledOnce();
        expect(mocks.invalidateTokenInfoForAction).toHaveBeenCalledWith('bitcoin-mainnet', request);
    });

    it('hydrates and throws structured host errors', async () => {
        const payload = { name: 'PermissionError', message: 'denied', code: 'EACCES' };
        const hydrated = Object.assign(new Error('denied'), { code: 'EACCES' });
        mocks.hydrateEnvelopeError.mockReturnValue(hydrated);
        globalThis.xchainWalletBridge = {
            sendMessage: vi.fn().mockResolvedValue({ ok: false, error: payload }),
        };

        await expect(sendMessage('wallet.export')).rejects.toBe(hydrated);
        expect(mocks.hydrateEnvelopeError).toHaveBeenCalledWith(payload);
        expect(mocks.invalidateTokenInfoForAction).not.toHaveBeenCalled();
    });

    it('preserves a rejected IPC call without attempting envelope hydration', async () => {
        const disconnected = new Error('ipc disconnected');
        globalThis.xchainWalletBridge = { sendMessage: vi.fn().mockRejectedValue(disconnected) };

        await expect(sendMessage('session.status')).rejects.toBe(disconnected);
        expect(mocks.hydrateEnvelopeError).not.toHaveBeenCalled();
    });
});
