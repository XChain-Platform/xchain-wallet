// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Dispenses tab rendered every row the explorer returned as a fill, and
// the explorer returns refused dispenses too, each with the amount the payer
// TRIED to buy. Observed on Dogecoin testnet: a payment refused because the
// payer was the dispenser's own pay-to address showed as a 500-token sale,
// indistinguishable from the 100-token fill above it. These drive the real
// component: a refused row must stay visible, say so, name the reason, and
// count for nothing.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'dogecoin-testnet';
const VIEWER = 'nViewerViewerViewerViewerViewerViewer1';
const OWNER = 'ndNNBSVgGUvHfh6k3xYmZVstV7nLRacsnH';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1', address: VIEWER, publicKey: '02ab',
        derivationPath: "m/44'/3'/0'/0/0", source: 'hd',
    }],
};

const DISPENSER = {
    action_index: '816',
    source: OWNER,
    address: OWNER,
    give_tick: 'DOGESWAP',
    give_amount: '100',
    get_tick: null,
    get_coin: 'DOGE',
    get_amount: '2.00000000',
    escrow_remaining: '1000',
    status: 'open',
    current_status: 'open',
};

// The two live rows, verbatim shape.
const HONOURED = {
    action_index: '820', dispenser_action_index: '816', give_tick: 'DOGESWAP',
    give_amount: '100', get_coin: 'DOGE', get_amount: '2.00000000',
    status: 'valid', block_index: 4102, timestamp: 1757620000,
};
const REFUSED = {
    action_index: '819', dispenser_action_index: '816', give_tick: 'DOGESWAP',
    give_amount: '500', get_coin: 'DOGE', get_amount: '450.02310427',
    status: 'invalid: SOURCE and GET_ADDRESS can not be same', block_index: 4101, timestamp: 1757619000,
};

function mount(dispenses) {
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(DISPENSER),
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getDispenses: vi.fn().mockResolvedValue({ data: dispenses }),
        getDispenserLifecycle: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w', chainId: CHAIN, actionIndex: '816',
                onBack() {}, onCanceled() {},
            }),
        ),
    );
    return messaging;
}

// The amount also appears in the stats hero, so rows are found as list items.
const rowOf = (text) => {
    const li = Array.from(document.querySelectorAll('li')).find((el) => el.textContent.includes(text));
    if (!li) throw new Error(`no list row containing ${text}`);
    return li;
};
const untilRows = () => waitFor(() => rowOf('DOGESWAP'));

afterEach(() => cleanup());

describe('dispenser detail: refused dispenses', () => {
    it('marks a refused row Invalid with the reason, and leaves the honoured row as it was', async () => {
        mount([HONOURED, REFUSED]);
        await untilRows();

        const refused = rowOf('500 DOGESWAP');
        const marker = within(refused).getByTestId('dispense-invalid');
        expect(marker).toHaveTextContent(/Invalid/);
        expect(marker).toHaveTextContent('SOURCE and GET_ADDRESS can not be same');
        expect(refused).toHaveTextContent(/for 450\.02310427 DOGE/);

        const honoured = rowOf('100 DOGESWAP');
        expect(within(honoured).queryByTestId('dispense-invalid')).toBeNull();
        expect(honoured).toHaveTextContent(/for 2\.00000000 DOGE/);
    });

    it('keeps the refused attempt in the list rather than dropping it', async () => {
        mount([HONOURED, REFUSED]);
        await untilRows();
        expect(rowOf('500 DOGESWAP')).toBeInTheDocument();
    });

    it('excludes the refused amount from the vended total', async () => {
        mount([HONOURED, REFUSED]);
        await untilRows();
        // 100 honoured; the 500 attempt moved nothing.
        expect(screen.getByTestId('vended-total')).toHaveTextContent('100 DOGESWAP in 1 fill');
    });

    it('shows no vended total when every dispense was refused', async () => {
        mount([REFUSED]);
        await untilRows();
        expect(screen.queryByTestId('vended-total')).toBeNull();
    });

    it('carries the marker into the lifecycle timeline', async () => {
        mount([HONOURED, REFUSED]);
        await untilRows();
        fireEvent.click(screen.getByRole('tab', { name: 'Lifecycle' }));
        const refused = rowOf('500 DOGESWAP');
        expect(refused).toHaveTextContent(/Dispense refused/);
        expect(within(refused).getByTestId('dispense-invalid')).toHaveTextContent(/Invalid/);
        const honoured = rowOf('100 DOGESWAP');
        expect(honoured).toHaveTextContent(/Dispensed/);
        expect(within(honoured).queryByTestId('dispense-invalid')).toBeNull();
    });
});
