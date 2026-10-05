// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mocked = vi.hoisted(() => ({ balancesFromSdk: vi.fn() }));

vi.mock('@xchain-wallet/core', () => ({
    decoder: { balancesFromSdk: mocked.balancesFromSdk },
}));

import { useTickBalance } from '../../../../packages/core/src/shared/hooks/useTickBalance.js';

const BASE = { walletId: 'w1', accountId: 'a1', chainId: 'bitcoin', address: 'addr1', tick: 'PEPE' };

let messaging;

function render(overrides = {}, msg = messaging) {
    return renderHook((props) => useTickBalance({ messaging: msg, ...BASE, ...props }), {
        initialProps: overrides,
    });
}

async function advance(ms) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function expectBalance(result, expected) {
    await vi.waitFor(() => expect(result.current).toBe(expected));
}

function stubBalances(rows, address = 'addr1', chainId = 'bitcoin') {
    messaging.getWalletBalances.mockResolvedValue({ [chainId]: [{ address, balances: {} }] });
    mocked.balancesFromSdk.mockReturnValue(rows);
}

beforeEach(() => {
    vi.useFakeTimers();
    messaging = { getWalletBalances: vi.fn() };
    mocked.balancesFromSdk.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useTickBalance gating', () => {
    it.each(['chainId', 'address', 'tick'])('stays null without %s and never queries', async (key) => {
        const { result } = render({ [key]: '' });
        await advance(400);
        expect(result.current).toBeNull();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
    });

    it('stays null when messaging lacks getWalletBalances', async () => {
        const { result } = render({}, {});
        await advance(400);
        expect(result.current).toBeNull();
    });
});

describe('useTickBalance lookup', () => {
    it('debounces by 400 ms then queries once with wallet and account', async () => {
        stubBalances([]);
        render();
        await advance(399);
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
        await advance(1);
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(1);
        expect(messaging.getWalletBalances).toHaveBeenCalledWith('w1', 'a1');
    });

    it('trims and upper-cases the tick and returns the amount as a string', async () => {
        stubBalances([{ tick: 'PEPE', amount: 12.5 }]);
        const { result } = render({ tick: ' pepe ' });
        await advance(400);
        await expectBalance(result, '12.5');
    });

    it('gives 0 when no row matches the tick', async () => {
        stubBalances([{ tick: 'OTHER', amount: '5' }]);
        const { result } = render();
        await advance(400);
        await expectBalance(result, '0');
    });

    it('gives 0 when the address has no entry', async () => {
        stubBalances([{ tick: 'PEPE', amount: '5' }], 'someone-else');
        const { result } = render();
        await advance(400);
        await expectBalance(result, '0');
    });

    it('gives 0 when the chain key is missing', async () => {
        stubBalances([{ tick: 'PEPE', amount: '5' }], 'addr1', 'other-chain');
        const { result } = render();
        await advance(400);
        await expectBalance(result, '0');
    });
});

describe('useTickBalance failure and lifecycle', () => {
    it('keeps null on a falsy result', async () => {
        messaging.getWalletBalances.mockResolvedValue(null);
        const { result } = render();
        await advance(400);
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(1);
        expect(result.current).toBeNull();
    });

    it('keeps null on a rejection', async () => {
        messaging.getWalletBalances.mockRejectedValue(new Error('down'));
        const { result } = render();
        await advance(400);
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(1);
        expect(result.current).toBeNull();
    });

    it('resets on address change and only the latest timer fires', async () => {
        stubBalances([{ tick: 'PEPE', amount: '7' }]);
        const { result, rerender } = render();
        await advance(400);
        await expectBalance(result, '7');
        messaging.getWalletBalances.mockClear();
        rerender({ address: 'addr2' });
        expect(result.current).toBeNull();
        await advance(200);
        rerender({ address: 'addr3' });
        await advance(399);
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
        await advance(1);
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(1);
    });

    it('clears the timer on unmount', async () => {
        const { unmount } = render();
        await advance(200);
        unmount();
        await advance(400);
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
    });
});
