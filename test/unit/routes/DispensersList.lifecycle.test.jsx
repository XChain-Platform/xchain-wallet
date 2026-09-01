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

function mount() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'a1', address: OWNER, source: 'hd' }],
        }),
        getDispensersForSource: vi.fn().mockResolvedValue({ data: ROWS }),
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
