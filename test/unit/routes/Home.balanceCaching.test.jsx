// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's balance reuse rule (operator ruling 2026-11-17): a saved read under
// five minutes old is shown with no balance request; an open Home checks every
// minute and reads only once the data is five minutes old; a broadcast, an
// explicit refresh and a switch to a scope with no fresh copy read at once.
// The clock and the interval are faked, and each step counts the reads.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { writeBalanceCache } from '../../../packages/core/src/shared/utils/balanceCache.js';
import { BALANCE_CHECK_INTERVAL_MS, BALANCE_MAX_AGE_MS } from '../../../packages/core/src/flows/balances.js';
import { buildCommands } from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';
import { sendMessage as desktopSendMessage } from '../../../packages/desktop/renderer/bridgeMessaging.js';

const WALLET = { id: 'wallet-cache', name: 'Cache Wallet' };
const ACCOUNT_A = { id: 'account-a', index: 0, walletId: WALLET.id };
const ACCOUNT_B = { id: 'account-b', index: 1, walletId: WALLET.id };
const BALANCES = {
    'bitcoin-mainnet': [{
        address: 'bc1qcachetest',
        balances: { native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] },
    }],
};
const MINUTE = 60_000;

function seedCache(accountId, ageMs, network = 'mainnet') {
    writeBalanceCache(WALLET.id, accountId, {
        balances: BALANCES,
        activeByChain: {},
        fetchedAt: Date.now() - ageMs,
    }, network);
}

function mountHome({ accountId = ACCOUNT_A.id } = {}) {
    const messaging = {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT_A, ACCOUNT_B]),
        getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
    };
    const view = (id) => React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Home, { activeWalletId: WALLET.id, activeAccountId: id }),
    );
    const utils = render(view(accountId));
    return { messaging, switchAccount: (id) => utils.rerender(view(id)) };
}

const reads = (messaging) => messaging.getWalletBalances.mock.calls.length;

const settle = async () => {
    for (let i = 0; i < 8; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    }
};
const wait = async (ms) => {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await settle();
};
const focus = async () => {
    act(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
};

function useClock() {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete globalThis.xchainWalletBridge;
});

describe('Home reuses saved balances for five minutes', () => {
    it('makes no balance request on open when the saved copy is 1 minute old', async () => {
        useClock();
        seedCache(ACCOUNT_A.id, MINUTE);
        const { messaging } = mountHome();
        await settle();
        expect(reads(messaging)).toBe(0);
        // The multisig and active-address reads are local and still run.
        expect(messaging.getActiveAddresses).toHaveBeenCalled();
    });

    it('makes one balance request on open when the saved copy is 6 minutes old', async () => {
        useClock();
        seedCache(ACCOUNT_A.id, 6 * MINUTE);
        const { messaging } = mountHome();
        await settle();
        expect(reads(messaging)).toBe(1);
    });

    it('the 60 s check reads nothing before five minutes and once after', async () => {
        useClock();
        seedCache(ACCOUNT_A.id, MINUTE);
        const { messaging } = mountHome();
        await settle();
        expect(reads(messaging)).toBe(0);

        // Checks at 2, 3 and 4 minutes of age: all fresh.
        await wait(3 * BALANCE_CHECK_INTERVAL_MS);
        expect(reads(messaging)).toBe(0);

        // The check at 5 minutes of age reads once, and that read is fresh again.
        await wait(BALANCE_CHECK_INTERVAL_MS);
        expect(reads(messaging)).toBe(1);
        await wait(4 * BALANCE_CHECK_INTERVAL_MS);
        expect(reads(messaging)).toBe(1);
        await wait(BALANCE_CHECK_INTERVAL_MS);
        expect(reads(messaging)).toBe(2);
    });

    it('a focus or visibility return before five minutes reads nothing, and one after reads once', async () => {
        useClock();
        seedCache(ACCOUNT_A.id, MINUTE);
        const { messaging } = mountHome();
        await settle();

        vi.setSystemTime(Date.now() + 3 * MINUTE);
        await focus();
        await focus();
        expect(reads(messaging)).toBe(0);

        vi.setSystemTime(Date.now() + BALANCE_MAX_AGE_MS);
        await focus();
        expect(reads(messaging)).toBe(1);
    });

    it('a broadcast through the shell transport reads once at once', async () => {
        useClock();
        seedCache(ACCOUNT_A.id, MINUTE);
        const { messaging } = mountHome();
        await settle();
        globalThis.xchainWalletBridge = {
            sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { txid: 'tx-1' } }),
        };

        // A compose preview moves no funds and leaves the saved copy alone.
        await act(async () => { await desktopSendMessage('action.composeForConfirm', { chainId: 'bitcoin-mainnet' }); });
        await settle();
        expect(reads(messaging)).toBe(0);

        await act(async () => { await desktopSendMessage('action.send', { chainId: 'bitcoin-mainnet' }); });
        await settle();
        expect(reads(messaging)).toBe(1);
    });

    it('a broadcast while Home is unmounted makes the next open read', async () => {
        useClock();
        seedCache(ACCOUNT_A.id, MINUTE);
        globalThis.xchainWalletBridge = {
            sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { txid: 'tx-2' } }),
        };
        await desktopSendMessage('broadcast.signedTx', { chainId: 'bitcoin-mainnet' });
        vi.setSystemTime(Date.now() + 1);
        const { messaging } = mountHome();
        await settle();
        expect(reads(messaging)).toBe(1);
    });

    it('an explicit refresh reads once whatever the age', async () => {
        useClock();
        seedCache(ACCOUNT_A.id, MINUTE);
        const { messaging } = mountHome();
        await settle();
        expect(reads(messaging)).toBe(0);

        const shellRefresh = vi.fn();
        const refresh = buildCommands({ navigate: vi.fn(), refresh: shellRefresh })
            .find((command) => command.id === 'wallet-refresh');
        act(() => { refresh.run(); });
        await settle();
        expect(shellRefresh).toHaveBeenCalledTimes(1);
        expect(reads(messaging)).toBe(1);
    });

    it('an account switch reads only when the new scope has no fresh copy', async () => {
        useClock();
        seedCache(ACCOUNT_A.id, MINUTE);
        const { messaging, switchAccount } = mountHome();
        await settle();
        expect(reads(messaging)).toBe(0);

        switchAccount(ACCOUNT_B.id);
        await settle();
        expect(reads(messaging)).toBe(1);
        expect(messaging.getWalletBalances).toHaveBeenLastCalledWith(WALLET.id, ACCOUNT_B.id);

        // Back to an account whose copy is still fresh: no request.
        switchAccount(ACCOUNT_A.id);
        await settle();
        expect(reads(messaging)).toBe(1);
    });

    it('a network switch with no saved copy for the new network reads once', async () => {
        useClock();
        seedCache(ACCOUNT_A.id, MINUTE);
        const { messaging } = mountHome();
        await settle();
        expect(reads(messaging)).toBe(0);

        act(() => {
            window.dispatchEvent(new CustomEvent('xc:settings-changed', { detail: { activeNetwork: 'testnet' } }));
        });
        await settle();
        expect(reads(messaging)).toBe(1);
    });
});
