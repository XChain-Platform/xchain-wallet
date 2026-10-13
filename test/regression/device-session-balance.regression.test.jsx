// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: device session and balance state.
//
//   [P1] 2026-10-13: Locking replaces the saved route with Home, so a
//        safe screen does not return after unlock; unsafe routes can linger.
//
//   [P0] 2026-10-13: Issue #74 presents a successful explorer response
//        with no native balance as zero instead of unavailable.

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    addressBalances,
    NATIVE_BALANCE_UNREADABLE_REASON,
} from '../../packages/core/src/flows/balances.js';
import { useLastView } from '../../packages/core/src/shared/hooks/useLastView.js';
import { readLastViewRoute } from '../../packages/core/src/shared/utils/lastViewMemory.js';
import { resetBackStackForTests } from '../../packages/core/src/ui/backStack.js';

const WALLET_ID = 'device-wallet';
const CHAIN_ID = 'dogecoin-testnet';
const ADDRESS = 'ndNNBSVgGUvHfh6k3xYmZVstV7nLRacsnH';

function LockCycleHarness() {
    const [sessionState, setSessionState] = useState('unlocked');
    const [view, setView] = useState('home');
    useLastView({
        walletId: WALLET_ID,
        sessionActive: sessionState === 'unlocked',
        currentView: view,
        onResume: setView,
    });
    return (
        <>
            <output>{sessionState}:{view}</output>
            <button type="button" onClick={() => setView('history')}>History</button>
            <button type="button" onClick={() => setView('send')}>Send</button>
            <button
                type="button"
                onClick={() => {
                    setSessionState('locked');
                    setView('home');
                }}
            >
                Lock
            </button>
            <button type="button" onClick={() => setSessionState('unlocked')}>Unlock</button>
        </>
    );
}

beforeEach(() => {
    localStorage.clear();
    resetBackStackForTests();
    window.history.replaceState(null, '');
});

afterEach(() => {
    cleanup();
    resetBackStackForTests();
});

describe('regression/device-session-balance', () => {
    it('[REGRESSION P1] restores a safe route after unlock and clears an unsafe route', async () => {
        render(<LockCycleHarness />);

        fireEvent.click(screen.getByRole('button', { name: 'History' }));
        await waitFor(() => expect(readLastViewRoute(WALLET_ID)?.view).toBe('history'));
        fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
        expect(screen.getByText('locked:home')).toBeInTheDocument();
        expect(readLastViewRoute(WALLET_ID)?.view).toBe('history');
        fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
        expect(await screen.findByText('unlocked:history')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await waitFor(() => expect(readLastViewRoute(WALLET_ID)).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
        fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
        expect(await screen.findByText('unlocked:home')).toBeInTheDocument();
    });

    it('[REGRESSION P0] treats issue 74 tracker downtime as unavailable, not zero', async () => {
        const sdk = {
            getAddress: vi.fn(async () => ({
                address: ADDRESS,
                balances: { confirmed: null, pending: null, received: null },
                tracker_available: false,
            })),
            getBalances: vi.fn(async () => ({ total: 0, data: [] })),
        };
        const chainRegistry = {
            descriptorFor: (id) => (id === CHAIN_ID
                ? { id, coin: 'dogecoin', networkKind: 'testnet' }
                : null),
        };

        const result = await addressBalances({
            sdkRegistry: { get: () => sdk },
            chainRegistry,
            chainId: CHAIN_ID,
            address: ADDRESS,
        });

        expect(result.native).toBeNull();
        expect(result.unavailable).toEqual(['native']);
        expect(result.unavailableReason).toBe(NATIVE_BALANCE_UNREADABLE_REASON);
    });
});
