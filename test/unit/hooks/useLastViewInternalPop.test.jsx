// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Closing an overlay makes the Back stack take its stale sentinel out with its
// own history.back(). That popstate is not the user pressing Back, so the
// shell's history must not move, or leaving a dialog would pop the page too.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLastView } from '../../../packages/core/src/shared/hooks/useLastView.js';
import { registerBackHandler, resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

// The entry the stale sentinel sat on: a resumable page and a page only the
// shell's own history can reopen, so both popstate branches are covered.
const RESUMABLE = { walletId: 'wallet-1', network: 'mainnet', view: 'history', params: null };
const POPPABLE = { walletId: 'wallet-1', network: 'mainnet', view: 'wallet-details', params: null };

let landOn = RESUMABLE;

beforeEach(() => {
    vi.useFakeTimers();
    resetBackStackForTests();
    // jsdom traverses history asynchronously; deliver the popstate at once so
    // the test sees exactly the event the Back stack's own Back produced.
    vi.spyOn(window.history, 'back').mockImplementation(() => {
        window.dispatchEvent(new PopStateEvent('popstate', { state: { xcRoute: landOn } }));
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    resetBackStackForTests();
    window.history.replaceState(null, '');
});

function renderShellHistory() {
    const onResume = vi.fn();
    const onHistoryPop = vi.fn(() => true);
    renderHook(() => useLastView({
        walletId: 'wallet-1',
        currentView: 'home',
        currentParams: null,
        network: 'mainnet',
        onResume,
        onHistoryPop,
    }));
    onResume.mockClear();
    onHistoryPop.mockClear();
    return { onResume, onHistoryPop };
}

/** Open an overlay, let its sentinel arm, then close it so the stale sentinel is taken out. */
function openAndCloseOverlay(registerFirst) {
    let unregister = registerFirst ? registerFirst() : null;
    if (!unregister) unregister = registerBackHandler(() => {}, 'overlay');
    act(() => { vi.runAllTimers(); });
    expect(window.history.state?.xcBack).toBe(true);
    unregister();
    act(() => { vi.runAllTimers(); });
    expect(window.history.back).toHaveBeenCalledTimes(1);
}

describe('useLastView ignores the Back stack taking out its own sentinel', () => {
    for (const [label, entry] of [['a resumable page', RESUMABLE], ['a page only the shell history reopens', POPPABLE]]) {
        it(`does not move the history when the sentinel sat on ${label}`, () => {
            landOn = entry;
            const { onResume, onHistoryPop } = renderShellHistory();

            openAndCloseOverlay();

            expect(onResume).not.toHaveBeenCalled();
            expect(onHistoryPop).not.toHaveBeenCalled();
        });

        it(`does not move the history when the Back stack heard the pop first, on ${label}`, () => {
            landOn = entry;
            // Registering before the hook mounts puts the Back stack's popstate
            // listener first, so the hook sees the event after the flag clears.
            const unregister = registerBackHandler(() => {}, 'overlay');
            const { onResume, onHistoryPop } = renderShellHistory();

            openAndCloseOverlay(() => unregister);

            expect(onResume).not.toHaveBeenCalled();
            expect(onHistoryPop).not.toHaveBeenCalled();
        });
    }

    it('still follows a Back the user pressed to the same entry', () => {
        landOn = POPPABLE;
        const { onHistoryPop } = renderShellHistory();

        act(() => {
            window.dispatchEvent(new PopStateEvent('popstate', { state: { xcRoute: POPPABLE } }));
        });

        expect(onHistoryPop).toHaveBeenCalledWith('wallet-details');
    });
});
