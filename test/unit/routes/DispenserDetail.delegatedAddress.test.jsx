// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A dispenser opened with a delegated GET_ADDRESS only fills when paid at
// that exact address; a payment to the opener's source address arrives as a
// plain transfer, with no dispense and no refund. The by-action-index read
// path returns the flattened DISPENSER action row, which spells the
// delegated address `get_address` (there is no `address` column on it), and
// the stats hero used to read only `dispenser.address` - so it fell back to
// `source` and presented the one address that must NOT be paid.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qownerownerownerownerownerownerownerow';
const DELEGATE = 'bc1qdelegatedelegatedelegatedelegatedele';

// Flattened action-row shape: `get_address` carries the delegated pay-to
// address and no `address` key exists, exactly as sdk.getAction returns it.
const DISPENSER = {
    action_index: '39',
    source: OWNER,
    get_address: DELEGATE,
    give_tick: 'JAVIERTEST',
    give_amount: '2',
    get_coin: 'BTC',
    get_amount: '0.00001',
    escrow_remaining: '48',
    status: 'valid',
    current_status: 'open',
};

function mount() {
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(DISPENSER),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w',
                chainId: CHAIN,
                actionIndex: '39',
                onBack() {},
                onCanceled() {},
            }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

describe('DispenserDetail with a delegated GET_ADDRESS', () => {
    it('shows the delegated address in the Address row, not the source', async () => {
        mount();
        // The delegated pay-to address must be on the page (Address row and
        // buy panel both read it).
        const delegated = await screen.findAllByLabelText(DELEGATE);
        expect(delegated.length).toBeGreaterThan(0);
        // The Address row must carry the delegate: its <dd> renders the
        // address untruncated, so the full string appears as text exactly
        // where the fallback used to print the source instead.
        expect(await screen.findAllByText(DELEGATE)).not.toHaveLength(0);
    });
});
