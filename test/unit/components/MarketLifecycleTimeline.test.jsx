// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MarketLifecycleTimeline } from '../../../packages/core/src/shared/components/MarketLifecycleTimeline.jsx';

const BASE_PROPS = {
    kind: 'order',
    chainId: 'bitcoin-mainnet',
    address: 'bc1qowner',
    actionIndex: 42,
    createdBlock: 100,
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('MarketLifecycleTimeline', () => {
    it('shows the known creation event when lifecycle messaging is unavailable', async () => {
        render(<MarketLifecycleTimeline {...BASE_PROPS} messaging={{}} />);

        const timeline = await screen.findByRole('list', { name: 'Trade lifecycle' });
        expect(within(timeline).getByText('Created')).toBeInTheDocument();
        expect(within(timeline).getByText('block 100')).toBeInTheDocument();
        expect(screen.queryByText('No lifecycle events yet.')).toBeNull();
    });

    it('loads, filters, sorts, and renders order lifecycle events', async () => {
        const getOrderLifecycle = vi.fn(({ kind }) => Promise.resolve({
            edits: { rows: [
                { action_index: 51, order_action_index: 42, block_index: 110 },
                { action_index: 52, order_action_index: 7, block_index: 999 },
            ] },
            expires: { data: [{ action_index: 53, order_action_index: '42', block_index: 130 }] },
            cancels: [{ action_index: 54, order_action_index: 8, block_index: 998 }],
            matches: { rows: [
                { action_index: 55, give_action_index: 42, block_index: 120, give_amount: '5', give_tick: 'XCP' },
                { action_index: 56, get_action_index: 9, block_index: 997, give_amount: '8', give_tick: 'XCP' },
            ] },
        }[kind]));

        render(<MarketLifecycleTimeline {...BASE_PROPS} messaging={{ getOrderLifecycle }} />);

        expect(screen.getByText('Loading timeline…')).toBeInTheDocument();
        const timeline = await screen.findByRole('list', { name: 'Trade lifecycle' });
        expect(getOrderLifecycle).toHaveBeenCalledTimes(4);
        expect(getOrderLifecycle).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            kind: 'edits',
            query: 'bc1qowner',
            type: 'address',
        });
        expect(getOrderLifecycle).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            kind: 'matches',
            query: '',
            type: 'block',
        });

        const events = within(timeline).getAllByRole('listitem');
        expect(events).toHaveLength(4);
        expect(events.map((event) => event.textContent)).toEqual([
            'Expiredblock 130',
            'Filled / matched5 XCP',
            'Editedblock 110',
            'Createdblock 100',
        ]);
    });

    it('uses swap messaging and keeps the creation event when a lane fails', async () => {
        const getSwapLifecycle = vi.fn(({ kind }) => {
            if (kind === 'cancels') return Promise.reject(new Error('offline'));
            if (kind === 'edits') {
                return Promise.resolve([{ action_index: 70, swap_action_index: '42', block_index: 140 }]);
            }
            return Promise.resolve([]);
        });

        render(
            <MarketLifecycleTimeline
                {...BASE_PROPS}
                kind="swap"
                messaging={{ getOrderLifecycle: vi.fn(), getSwapLifecycle }}
            />,
        );

        const timeline = await screen.findByRole('list', { name: 'Trade lifecycle' });
        await waitFor(() => expect(getSwapLifecycle).toHaveBeenCalledTimes(4));
        expect(within(timeline).getByText('Edited')).toBeInTheDocument();
        expect(within(timeline).getByText('Created')).toBeInTheDocument();
    });

    it('uses unique keys when lifecycle rows repeat an action index', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const getOrderLifecycle = vi.fn(({ kind }) => Promise.resolve(kind === 'edits' ? [
            { action_index: 51, order_action_index: 42, block_index: 110 },
            { action_index: 51, order_action_index: 42, block_index: 109 },
        ] : []));
        render(<MarketLifecycleTimeline {...BASE_PROPS} messaging={{ getOrderLifecycle }} />);

        await waitFor(() => expect(screen.getAllByText('Edited')).toHaveLength(2));
        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key/i);
        consoleError.mockRestore();
    });
});
