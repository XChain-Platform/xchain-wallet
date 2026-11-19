// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { settingsState } = vi.hoisted(() => ({
    settingsState: { settings: null, loading: true, error: null },
}));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => settingsState,
}));

const { useDeveloperMode } = await import(
    '../../../packages/core/src/shared/hooks/useDeveloperMode.js'
);
const { publishWalletModes, useWalletMode } = await import(
    '../../../packages/core/src/shared/hooks/useWalletMode.js'
);

beforeEach(() => {
    settingsState.settings = null;
    settingsState.loading = true;
    settingsState.error = null;
});

describe('settings convenience hooks', () => {
    it('keeps developer features hidden until settings are ready', () => {
        const { result, rerender } = renderHook(() => useDeveloperMode());

        expect(result.current).toEqual({ developerMode: false, ready: false, error: null });

        settingsState.settings = { developerMode: true };
        settingsState.loading = false;
        rerender();
        expect(result.current).toEqual({ developerMode: true, ready: true, error: null });
    });

    // §20: the mode is the active wallet's own; a legacy settings value
    // never reaches the flags.
    it('returns the default wallet mode and exhaustive mode flags', () => {
        const { result, rerender } = renderHook(() => useWalletMode());

        expect(result.current).toEqual({
            walletMode: 'full', isFullMode: true, isWatcherMode: false, isSignerMode: false, walletModeKnown: true,
        });

        settingsState.settings = { walletMode: 'watcher' };
        rerender();
        expect(result.current.walletMode).toBe('full');

        act(() => { publishWalletModes({ wallets: [{ id: 'w', walletMode: 'signer' }], activeWalletId: 'w' }); });
        expect(result.current).toEqual({
            walletMode: 'signer', isFullMode: false, isWatcherMode: false, isSignerMode: true, walletModeKnown: true,
        });
    });
});
