// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every History button carries an icon, and the export dialog's main action
// is the green one (U63).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const CHAIN = 'litecoin-regtest';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';

function row(n) {
    return {
        action: 'SEND',
        action_index: n,
        block_index: 100 + n,
        timestamp: Math.floor(Date.now() / 1000) - n * 3600,
        tx_hash: `tx${String(n).padStart(4, '0')}`,
        details: { source: ADDRESS, destination: 'mrecipient', tick: 'LTC', amount: '1.25' },
    };
}

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

const hasIcon = (button) => Boolean(button.querySelector('svg'));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('History buttons carry icons', () => {
    it('gives Export and the export dialog actions icons, with the dialog Export green', async () => {
        mountHistory([row(1)]);
        const trigger = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(trigger).toBeEnabled());
        expect(hasIcon(trigger)).toBe(true);
        fireEvent.click(trigger);
        const dialog = await screen.findByRole('dialog', { name: 'Export history' });
        const confirm = within(dialog).getByRole('button', { name: 'Export' });
        expect(hasIcon(confirm)).toBe(true);
        expect(confirm.className).toContain(buttonStyles.success);
        expect(hasIcon(within(dialog).getByRole('button', { name: 'Cancel' }))).toBe(true);
    });

    // The title-bar filter's search box is a native search field, so the old
    // separate Clear search button is retired; there is no button left to carry an icon.
    it('no longer draws a separate Clear search button', async () => {
        mountHistory([row(1)]);
        await screen.findByRole('button', { name: 'Export…' });
        // The search box lives in the title-bar filter, so open the filter first.
        fireEvent.click(screen.getByRole('button', { name: 'History filters' }));
        const search = await screen.findByLabelText('Search history');
        fireEvent.change(search, { target: { value: 'tx' } });
        expect(search.value).toBe('tx');
        expect(screen.queryByRole('button', { name: 'Clear history search' })).toBeNull();
    });

    it('gives Show more an icon when the list pages', async () => {
        mountHistory(Array.from({ length: 160 }, (_, i) => row(i + 1)));
        const more = await screen.findByRole('button', { name: 'Show More History' }, { timeout: 4000 });
        expect(hasIcon(more)).toBe(true);
    });
});
