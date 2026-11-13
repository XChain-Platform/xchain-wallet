// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's Tokens tab lists only tokens the wallet holds, as one list. Tokens
// the wallet issued but no longer holds are managed under My tokens, so the
// tab has no "Issued by you" section and does not read owned tokens for one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => null,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const balances = {
    'bitcoin-mainnet': [{
        address: 'bitcoin-mainnet-addr',
        balances: {
            tokens: [{ tick: 'HELD', quantity: '5', divisibility: 0, fiatRate: 1 }],
        },
    }],
};

function mount(settings) {
    const messaging = {
        getSettings: vi.fn(async () => settings),
        getOwnedTokens: vi.fn(async () => [
            { tick: 'HELD', divisibility: 0 },
            { tick: 'ISSUEDONLY', divisibility: 0 },
        ]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <HomeTabs
                chainRegistry={defaultRegistry()}
                balances={balances}
                walletId="real-wallet-1"
                networkFilter="all"
            />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => cleanup());

describe('HomeTabs Tokens tab', () => {
    it('lists held tokens only, with no issued-by-you section or owned-token read', async () => {
        const messaging = mount({ fiatCurrency: 'USD' });
        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));

        expect((await screen.findAllByText('HELD')).length).toBeGreaterThan(0);
        expect(screen.queryByText('ISSUEDONLY')).toBeNull();
        expect(screen.queryByText('Issued by you')).toBeNull();
        expect(document.querySelector('[data-testid="issued-unheld"]')).toBeNull();
        expect(messaging.getOwnedTokens).not.toHaveBeenCalled();
    });

    it('reads owned tokens only for the unknown-token filter, and still lists no issued token', async () => {
        const messaging = mount({ fiatCurrency: 'USD', hideUnknownTokens: true });
        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));

        await waitFor(() => expect(messaging.getOwnedTokens).toHaveBeenCalled());
        // Let the owned-token read land before checking it added no row.
        await act(async () => { await Promise.resolve(); });
        expect((await screen.findAllByText('HELD')).length).toBeGreaterThan(0);
        expect(screen.queryByText('ISSUEDONLY')).toBeNull();
        expect(screen.queryByText('Issued by you')).toBeNull();
    });
});
