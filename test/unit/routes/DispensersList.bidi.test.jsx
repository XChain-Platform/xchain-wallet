// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// On a right-to-left page a bare "250 DOGI per 100 DOGE" prints as
// "DOGI per 100 DOGE 250": the number at the line start orders after the
// Latin run. Each dispenser row isolates its rate and escrow lines so a
// quantity stays in front of its ticker.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';

const CHAIN = 'dogecoin-mainnet';
const OWNER = 'D7ownerownerownerownerownerownerowner0001';

const ROW = {
    action_index: '40', block_index: 200, source: OWNER,
    give_tick: 'JAVIERTEST', give_amount: '250',
    get_coin: 'DOGE', get_amount: '100',
    status: 'valid', current_status: 'open', escrow_remaining: '4750',
};

afterEach(cleanup);

describe('dispenser rows on a right-to-left page', () => {
    it('isolates the rate and escrow lines as left-to-right text', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: OWNER, source: 'hd' }] }),
            getDispensersForSource: vi.fn().mockResolvedValue({ data: [ROW] }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DispensersList walletId="w" onOpenDispenser={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );

        for (const pattern of [/per 100 DOGE/, /in escrow/]) {
            const line = await screen.findByText(pattern);
            expect(line.tagName, String(pattern)).toBe('BDI');
            expect(line.getAttribute('dir'), String(pattern)).toBe('ltr');
        }
    });
});
