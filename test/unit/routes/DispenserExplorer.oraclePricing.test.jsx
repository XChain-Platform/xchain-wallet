// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The buyer-side dispenser search quoted an oracle-priced (Mode B) dispenser
// as "1 MGRTEST per 0 DOGE", printing the create row's GET_AMOUNT 0 as its
// price. Rows are shaped as the explorer's token lane serves them.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserExplorer } from '../../../packages/core/src/shared/routes/DispenserExplorer.jsx';

const ORACLE = 'ndDEAAsomeoracleaddresssomeoracleaddress01';
const MODE_B_ROW = {
    action_index: '2868', source: 'nqdPCKownerownerownerownerownerowner01',
    give_tick: 'MGRTEST', give_amount: '1', get_coin: 'DOGE', get_tick: null, get_amount: '0',
    oracle_address: ORACLE, status: 'valid', current_status: 'open', escrow_remaining: '48',
};

function renderExplorer(extra = {}) {
    const messaging = {
        getSettings: async () => ({ schemaVersion: 2, activeNetwork: 'regtest' }),
        updateSettings: async (p) => p,
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [MODE_B_ROW] }),
        getDispensersForAddress: vi.fn(),
        ...extra,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DispenserExplorer onOpenDispenser={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function searchFor(token) {
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: token } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
}

afterEach(() => cleanup());

describe('DispenserExplorer result price for an oracle-priced dispenser', () => {
    it('quotes the oracle fill price, not zero coin', async () => {
        const messaging = renderExplorer({
            oracleFeeds: vi.fn().mockResolvedValue([{ tick: 'MGRTEST', fiat: 'USD', live: { value: '0.05' } }]),
        });
        await searchFor('MGRTEST');
        expect(await screen.findAllByText(/1 MGRTEST per 0\.05 USD \(oracle ndDEAA/)).not.toHaveLength(0);
        expect(screen.getAllByText(/status open/)).not.toHaveLength(0);
        expect(screen.queryAllByText(/status valid/)).toHaveLength(0);
        expect(document.body.textContent).not.toMatch(/per 0 DOGE/);
        expect(messaging.oracleFeeds).toHaveBeenCalledWith(expect.objectContaining({ address: ORACLE }));
    });

    it('says so when the oracle has no current price', async () => {
        renderExplorer({
            oracleFeeds: vi.fn().mockResolvedValue([{ tick: 'MGRTEST', fiat: 'USD', live: null }]),
        });
        await searchFor('MGRTEST');
        expect(await screen.findAllByText(/no current price, stale/)).not.toHaveLength(0);
    });

    it('shows the explorer stale-price state instead of advertising a rate', async () => {
        renderExplorer({
            getDispensersForToken: vi.fn().mockResolvedValue({
                data: [{ ...MODE_B_ROW, price_stale: true }],
            }),
            oracleFeeds: vi.fn().mockResolvedValue([{
                tick: 'MGRTEST', fiat: 'USD', live: { value: '0.05' },
            }]),
        });
        await searchFor('MGRTEST');
        expect(await screen.findAllByText(/Not selling right now: no price in the last 24 hours/))
            .not.toHaveLength(0);
        expect(screen.queryAllByText(/1 MGRTEST per 0\.05 USD/)).toHaveLength(0);
    });

    it('never quotes zero coin on a host that cannot read oracle feeds', async () => {
        renderExplorer();
        await searchFor('MGRTEST');
        expect(await screen.findAllByText(/open the dispenser for the price/)).not.toHaveLength(0);
        expect(document.body.textContent).not.toMatch(/per 0 DOGE/);
    });
});
