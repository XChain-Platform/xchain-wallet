// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One null or scalar entry in an explorer answer must not hide the valid
// dispensers beside it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';

const CHAIN = 'bitcoin-testnet';
const OWNER = 'tb1qownerownerownerownerownerownerownerow';
const GOOD = {
    action_index: '40', block_index: 200, source: OWNER,
    give_tick: 'JAVIERTEST', give_amount: '2',
    get_coin: 'BTC', get_amount: '0.00001',
    status: 'valid', current_status: 'open', escrow_remaining: '48',
};

afterEach(() => cleanup());

describe('DispensersList with malformed explorer rows', () => {
    it.each([null, 'text', 7, true])('lists the valid dispenser beside a %s entry', async (bad) => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'a1', address: OWNER, source: 'hd' }],
            }),
            getDispensersForSource: vi.fn().mockResolvedValue({ data: [bad, GOOD] }),
        };
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispensersList, { walletId: 'w', onOpenDispenser() {}, onBack() {} }),
        ));
        expect(await screen.findByRole('button', { name: 'Open JAVIERTEST dispenser #40' })).toBeInTheDocument();
    });
});
