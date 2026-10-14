// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const extension = vi.hoisted(() => ({
    connectExtensionWallet: vi.fn(),
    disableExtensionWallet: vi.fn(),
    hasExtensionProvider: vi.fn(),
    readExtensionWalletPreference: vi.fn(),
}));

vi.mock('../../../packages/web/src/extensionWallet.js', () => extension);

import { useExtensionWallet } from '../../../packages/web/src/useExtensionWallet.js';

beforeEach(() => {
    extension.connectExtensionWallet.mockReset();
    extension.disableExtensionWallet.mockReset();
    extension.hasExtensionProvider.mockReset().mockReturnValue(false);
    extension.readExtensionWalletPreference.mockReset().mockReturnValue(false);
});

afterEach(cleanup);

describe('useExtensionWallet', () => {
    it('detects a provider injected after mount and restores the preference', () => {
        const { result } = renderHook(() => useExtensionWallet());
        expect(result.current).toMatchObject({ present: false, enabled: false });

        extension.hasExtensionProvider.mockReturnValue(true);
        extension.readExtensionWalletPreference.mockReturnValue(true);
        act(() => window.dispatchEvent(new Event('xchain#initialized')));

        expect(result.current).toMatchObject({ present: true, enabled: true });
    });

    it('reports connecting state and enables after a successful handshake', async () => {
        let finishConnect;
        extension.connectExtensionWallet.mockReturnValue(new Promise((resolve) => {
            finishConnect = resolve;
        }));
        const { result } = renderHook(() => useExtensionWallet());
        let enabled;

        act(() => {
            enabled = result.current.enable();
        });
        expect(result.current.connecting).toBe(true);

        await act(async () => finishConnect({ ok: true }));
        await expect(enabled).resolves.toBe(true);
        expect(result.current).toMatchObject({ enabled: true, connecting: false, error: null });
    });

    it.each([
        [{ ok: false, error: 'USER_REJECTED' }, 'Connection declined in the wallet.'],
        [{ ok: false, error: 'BLOCKED_BY_USER' }, 'This site is blocked. Un-block it in the wallet settings.'],
        [{ ok: false, error: 'WALLET_LOCKED' }, 'Unlock the extension wallet, then try again.'],
        [{ ok: false, error: 'BRIDGE_VERSION_MISMATCH' }, 'The extension wallet is too old for this app. Update it and try again.'],
        [{ ok: false, error: 'THROTTLED', retryAfterMs: 2100 }, 'Too many requests. Try again in 3s.'],
    ])('keeps the local wallet enabled state on a refused handshake', async (refusal, message) => {
        extension.connectExtensionWallet.mockResolvedValue(refusal);
        const { result } = renderHook(() => useExtensionWallet());
        let enabled;

        await act(async () => {
            enabled = await result.current.enable();
        });

        expect(enabled).toBe(false);
        expect(result.current).toMatchObject({ enabled: false, connecting: false, error: message });
    });

    it('surfaces transport failures and clears state when disabled', async () => {
        extension.connectExtensionWallet.mockRejectedValue(new Error('provider disconnected'));
        const { result } = renderHook(() => useExtensionWallet());

        await act(async () => result.current.enable());
        expect(result.current.error).toBe('provider disconnected');

        act(() => result.current.disable());
        expect(extension.disableExtensionWallet).toHaveBeenCalledTimes(1);
        expect(result.current).toMatchObject({ enabled: false, error: null });
    });
});
