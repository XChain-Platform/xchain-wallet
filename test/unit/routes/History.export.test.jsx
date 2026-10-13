// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { userEvent } from '../../helpers/userEvent.js';

const CHAIN = 'litecoin-regtest';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';

function mountHistory(rows) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getAddressHistory: vi.fn().mockResolvedValue(rows),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'EUR' }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="w1" accountId="a1" />
        </MessagingProvider>,
    );
}

function historyRow() {
    return {
        action: 'SEND',
        action_index: 12,
        block_index: 100,
        timestamp: Math.floor(Date.now() / 1000),
        tx_hash: 'abc123',
        details: {
            source: ADDRESS,
            destination: 'mrecipient',
            tick: 'LTC',
            amount: '1.25',
            memo: 'visible row',
        },
    };
}

afterEach(() => cleanup());

describe('History export button', () => {
    it('tabs through every export choice, wraps focus, and returns focus after Escape', async () => {
        const user = userEvent.setup();
        mountHistory([historyRow()]);

        const trigger = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(trigger).toBeEnabled());
        trigger.focus();
        await user.keyboard('{Enter}');

        const dialog = await screen.findByRole('dialog', { name: 'Export history' });
        const controls = Array.from(dialog.querySelectorAll('input, button'));
        expect(controls).toHaveLength(17);
        await waitFor(() => expect(controls[0]).toHaveFocus());
        for (const control of controls.slice(1)) {
            await user.tab();
            expect(control).toHaveFocus();
        }
        await user.tab();
        expect(controls[0]).toHaveFocus();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull();
        expect(trigger).toHaveFocus();
    });

    it('is enabled for visible rows and disabled with a reason when filters hide them', async () => {
        mountHistory([historyRow()]);

        const button = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(button).toBeEnabled());

        fireEvent.change(screen.getByLabelText('Search history'), {
            target: { value: 'no such transaction' },
        });

        await waitFor(() => expect(button).toBeDisabled());
        expect(screen.getByText('No rows match the current filters.')).toBeInTheDocument();
        expect(button).toHaveAttribute('aria-describedby', 'history-export-disabled-reason');
    });

    it('is disabled with an explanation when there is no history', async () => {
        mountHistory([]);

        const button = await screen.findByRole('button', { name: 'Export…' });
        expect(button).toBeDisabled();
        expect(screen.getByText('There are no history rows to export.')).toBeInTheDocument();
    });
});

describe('History export shortcut (§34.2)', () => {
    it('opens the export dialog on e when rows are visible', async () => {
        mountHistory([historyRow()]);

        const button = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.keyDown(document.body, { key: 'e' });

        expect(await screen.findByRole('dialog', { name: 'Export history' })).toBeInTheDocument();
        expect(screen.getByText('Fiat currency (EUR)')).toBeInTheDocument();
    });

    it('leaves the export dialog closed on e when there is no history', async () => {
        mountHistory([]);

        const button = await screen.findByRole('button', { name: 'Export…' });
        expect(button).toBeDisabled();
        fireEvent.keyDown(document.body, { key: 'e' });

        expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull();
    });
});
