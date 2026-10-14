// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ messaging: null }));

vi.mock('@xchain-wallet/core', () => ({
    flows: { isDemoWallet: (walletId) => walletId === 'demo-wallet' },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: mocked.messaging }),
}));

import { useSignerReady } from '../../../packages/core/src/shared/hooks/useSignerReady.js';

beforeEach(() => {
    mocked.messaging = { signerReady: vi.fn() };
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useSignerReady', () => {
    it('stays conservative without a wallet or signer-ready endpoint', () => {
        const { result, rerender } = renderHook(
            ({ walletId }) => useSignerReady(walletId),
            { initialProps: { walletId: null } },
        );
        expect(result.current).toBe(false);
        expect(mocked.messaging.signerReady).not.toHaveBeenCalled();

        mocked.messaging = {};
        rerender({ walletId: 'wallet-1' });
        expect(result.current).toBe(false);
    });

    it('marks demo wallets ready without consulting the background', () => {
        const { result } = renderHook(() => useSignerReady('demo-wallet'));

        expect(result.current).toBe(true);
        expect(mocked.messaging.signerReady).not.toHaveBeenCalled();
    });

    it('reflects the background response and falls back to false on failure', async () => {
        mocked.messaging.signerReady
            .mockResolvedValueOnce({ ready: true })
            .mockRejectedValueOnce(new Error('worker restarted'));
        const { result, rerender } = renderHook(
            ({ walletId }) => useSignerReady(walletId),
            { initialProps: { walletId: 'wallet-1' } },
        );

        await waitFor(() => expect(result.current).toBe(true));
        expect(mocked.messaging.signerReady).toHaveBeenCalledWith({ walletId: 'wallet-1' });

        rerender({ walletId: 'wallet-2' });
        await waitFor(() => expect(result.current).toBe(false));
        expect(mocked.messaging.signerReady).toHaveBeenCalledWith({ walletId: 'wallet-2' });
    });

    it('ignores a stale response after the active wallet changes', async () => {
        let resolveFirst;
        const first = new Promise((resolve) => { resolveFirst = resolve; });
        mocked.messaging.signerReady.mockImplementation(({ walletId }) => (
            walletId === 'wallet-1' ? first : Promise.resolve({ ready: true })
        ));
        const { result, rerender } = renderHook(
            ({ walletId }) => useSignerReady(walletId),
            { initialProps: { walletId: 'wallet-1' } },
        );

        rerender({ walletId: 'wallet-2' });
        await waitFor(() => expect(result.current).toBe(true));
        resolveFirst({ ready: false });
        await Promise.resolve();
        expect(result.current).toBe(true);
    });
});
