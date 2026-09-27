// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The list lane's `status` column is the DISPENSER action's validity,
// frozen at 'valid' forever, so every row - open, cancelled, drained -
// used to wear the same grey `valid` badge, and a cancelled dispenser
// went on advertising its (refunded) escrow. The badge must show the
// lifecycle state the explorer now serves as `current_status`, and a
// terminal row must not claim tokens are "in escrow".

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';

const CHAIN = 'bitcoin-testnet';
const OWNER = 'tb1qownerownerownerownerownerownerownerow';

const ROWS = [
    {
        action_index: '40', block_index: 200, source: OWNER,
        give_tick: 'JAVIERTEST', give_amount: '2',
        get_coin: 'BTC', get_amount: '0.00001',
        status: 'valid', current_status: 'open', escrow_remaining: '48',
    },
    {
        action_index: '31', block_index: 150, source: OWNER,
        give_tick: 'JAVIERTEST', give_amount: '1',
        get_coin: 'BTC', get_amount: '0.0000001',
        status: 'valid', current_status: 'cancelled', escrow_remaining: '0',
    },
];

function mount({ rows = ROWS, lifecycle, tipRead } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'a1', address: OWNER, source: 'hd' }],
        }),
        getDispensersForSource: vi.fn().mockResolvedValue({ data: rows }),
        ...(lifecycle ? { getDispenserLifecycle: lifecycle } : {}),
        ...(tipRead ? { getChainTipBlockTime: tipRead } : {}),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispensersList, {
                walletId: 'w',
                onOpenDispenser() {},
                onBack() {},
            }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

describe('DispensersList lifecycle badges', () => {
    it('badges each row with its lifecycle state, never the action validity', async () => {
        mount();
        expect(await screen.findByText('open')).toBeInTheDocument();
        expect(screen.getByText('cancelled')).toBeInTheDocument();
        expect(screen.queryByText('valid')).not.toBeInTheDocument();
    });

    it('states escrow on the open row only; a cancelled row holds nothing', async () => {
        mount();
        expect(await screen.findByText(/48 JAVIERTEST in escrow/)).toBeInTheDocument();
        expect(screen.queryByText(/0 JAVIERTEST in escrow/)).not.toBeInTheDocument();
    });
});

describe('DispensersList closing badge', () => {
    const CANCEL_AT = 1790455620;
    const CLOSING_ROW = { ...ROWS[0], action_index: '18', current_status: 'cancelling', escrow_remaining: '12' };
    const cancelRow = { action_index: '19', dispenser_action_index: '18', source: OWNER, block_index: 500, timestamp: CANCEL_AT, status: 'valid' };

    afterEach(() => { vi.useRealTimers(); });

    it('reads "Closing" with a countdown from one cancels read per address', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime((CANCEL_AT + 37 * 60) * 1000);
        const lifecycle = vi.fn().mockResolvedValue({ data: [cancelRow] });
        mount({ rows: [CLOSING_ROW, ROWS[1]], lifecycle });
        expect(await screen.findByText('Closing · ~23 min')).toBeInTheDocument();
        expect(lifecycle).toHaveBeenCalledTimes(1);
        expect(lifecycle).toHaveBeenCalledWith({ chainId: CHAIN, kind: 'cancels', query: OWNER, type: 'address' });
        expect(screen.queryByText('cancelling')).not.toBeInTheDocument();
    });

    it('counts down on the chain\'s protocol time, read once per chain, not per row', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // The wall clock reads the window's end; the chain trails it by 29 minutes.
        vi.setSystemTime((CANCEL_AT + 3600) * 1000);
        const second = { ...CLOSING_ROW, action_index: '21' };
        const lifecycle = vi.fn().mockResolvedValue({
            data: [cancelRow, { ...cancelRow, action_index: '22', dispenser_action_index: '21' }],
        });
        const tipRead = vi.fn().mockResolvedValue({ chainId: CHAIN, blockTime: null, protocolTime: CANCEL_AT + 3600 - 29 * 60 });
        mount({ rows: [CLOSING_ROW, second], lifecycle, tipRead });
        expect(await screen.findAllByText('Closing · ~29 min')).toHaveLength(2);
        expect(tipRead).toHaveBeenCalledTimes(1);
        expect(tipRead).toHaveBeenCalledWith({ chainId: CHAIN, withProtocolTime: true });
    });

    it('reads "Closing · next block" once the chain has passed the window', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime((CANCEL_AT + 3600 + 90) * 1000);
        const lifecycle = vi.fn().mockResolvedValue({ data: [cancelRow] });
        const tipRead = vi.fn().mockResolvedValue({ chainId: CHAIN, blockTime: null, protocolTime: CANCEL_AT + 3601 });
        mount({ rows: [CLOSING_ROW], lifecycle, tipRead });
        expect(await screen.findByText('Closing · next block')).toBeInTheDocument();
    });

    it('keeps the wall-clock countdown when the chain read has no protocol time', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime((CANCEL_AT + 37 * 60) * 1000);
        const lifecycle = vi.fn().mockResolvedValue({ data: [cancelRow] });
        const tipRead = vi.fn().mockResolvedValue({ chainId: CHAIN, blockTime: 1790460068, protocolTime: null });
        mount({ rows: [CLOSING_ROW], lifecycle, tipRead });
        expect(await screen.findByText('Closing · ~23 min')).toBeInTheDocument();
    });

    it('reads "Closing" alone when the cancel time is not available', async () => {
        const lifecycle = vi.fn().mockResolvedValue({ data: [] });
        mount({ rows: [CLOSING_ROW], lifecycle });
        expect(await screen.findByText('Closing')).toBeInTheDocument();
    });

    it('makes no cancels read when no row is closing', async () => {
        const lifecycle = vi.fn().mockResolvedValue({ data: [] });
        mount({ lifecycle });
        expect(await screen.findByText('open')).toBeInTheDocument();
        expect(lifecycle).not.toHaveBeenCalled();
    });
});
