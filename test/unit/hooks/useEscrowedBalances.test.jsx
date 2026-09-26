// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's escrow read: merged into the balances once it lands, throttled to one
// read a minute per address set, and a failed read keeps the last good answer.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEscrowedBalances, ESCROW_REFRESH_MS } from '../../../packages/core/src/shared/hooks/useEscrowedBalances.js';

const OWNER = 'tltc1ql05c4je6cjg5ejzyrrr2nxvdr7htmf5eelek37';
const balances = { 'litecoin-testnet': [{ address: OWNER, balances: { tokens: [] } }] };
const active = { 'litecoin-testnet': { address: OWNER } };
const BEER = { rows: [{ tick: 'BEER', amount: '12', offers: { dispenser: 1 } }], partial: false };

afterEach(() => { vi.restoreAllMocks(); });

describe('useEscrowedBalances', () => {

    it('merges the escrow read into the shown address\'s entry', async () => {
        const messaging = { getEscrowedTokens: vi.fn(async () => BEER) };
        const { result } = renderHook(() => useEscrowedBalances({ balances, activeByChain: active, balancesFetchedAt: 1, messaging }));
        await waitFor(() => expect(result.current['litecoin-testnet'][0].balances.escrow).toEqual(BEER.rows));
        expect(messaging.getEscrowedTokens).toHaveBeenCalledWith({ chainId: 'litecoin-testnet', address: OWNER });
    });

    it('does not re-read on a balance refresh inside the minute, and keeps the last answer on a failed read', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const messaging = { getEscrowedTokens: vi.fn(async () => BEER) };
        const { result, rerender } = renderHook(
            (p) => useEscrowedBalances({ balances, activeByChain: active, balancesFetchedAt: p.at, messaging }),
            { initialProps: { at: 1 } },
        );
        await waitFor(() => expect(result.current['litecoin-testnet'][0].balances.escrow).toBeTruthy());
        now += 1000;
        rerender({ at: 2 });
        expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(1);

        messaging.getEscrowedTokens.mockRejectedValueOnce(new Error('429'));
        now += ESCROW_REFRESH_MS;
        rerender({ at: 3 });
        await waitFor(() => expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(2));
        expect(result.current['litecoin-testnet'][0].balances.escrow).toEqual(BEER.rows);
    });

    it('passes balances through untouched on a shell without the route', () => {
        const { result } = renderHook(() => useEscrowedBalances({ balances, activeByChain: active, messaging: {} }));
        expect(result.current).toBe(balances);
    });

});
