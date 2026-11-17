// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';

const WEEK_MS = 7 * 86_400_000;

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

function mountDemo() {
    markDemoWallet('demo-wallet');
    // The demo reads its fixtures, never the live chain; the tip included.
    const messaging = { getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 920_000 }) };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <StakeDetail
                walletId="demo-wallet"
                kind="validator"
                // The regtest demo prices XCHAIN in its balance fixture, and
                // its staking fixture resolves to the mainnet one.
                chainId="bitcoin-regtest"
                address="bcrt1qdemostakerdemostakerdemostakerdemo0"
                onBack={vi.fn()}
                onUnstake={vi.fn()}
                onClaimRewards={vi.fn()}
                onDelegate={vi.fn()}
                onRevokeDelegation={vi.fn()}
            />
        </MessagingProvider>,
    );
    return messaging;
}

// "~Nov 11, 2026" -> ms.
function projected(text) {
    return Date.parse(text.replace(/^~/, ''));
}

describe('StakeDetail in the demo wallet', () => {
    it('keeps every wired tile enabled and shows no demo notice', async () => {
        const messaging = mountDemo();

        // The shared action list (G101): a locked row is aria-disabled.
        const list = await screen.findByRole('list', { name: 'Stake actions' });
        await waitFor(() => expect(list.querySelector('[data-action-id="revoke"]')).toBeTruthy());
        for (const id of ['unstake', 'claim', 'delegate', 'revoke']) {
            const row = list.querySelector(`[data-action-id="${id}"]`);
            await waitFor(() => expect(row.getAttribute('aria-disabled')).toBeNull());
        }
        expect(document.body.textContent).not.toMatch(/demo/i);
        expect(messaging.getIndexerWatermark).not.toHaveBeenCalled();
    });

    it('prices the stake from the demo fixture and dates its events within the last week', async () => {
        mountDemo();

        expect(await screen.findByLabelText('50,000 XCHAIN staked')).toBeInTheDocument();
        // 50,000 XCHAIN at the fixture's $1.25.
        expect(screen.getByText('≈ $62,500.00')).toBeInTheDocument();
        // The balance line rose this week as rewards accrued.
        expect(screen.getByLabelText(/^1W change ▲ \+/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'Rewards' }));
        const now = Date.now();
        for (const row of within(screen.getByRole('list', { name: 'Reward events' })).getAllByRole('listitem')) {
            const date = row.textContent.match(/~\w{3} \d{1,2}, \d{4}/)?.[0];
            expect(date).toBeTruthy();
            expect(now - projected(date)).toBeLessThan(WEEK_MS);
        }

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const details = screen.getByRole('list', { name: 'Stake details' });
        expect(now - projected(within(details).getByText('Staked on').closest('li').textContent.match(/~.*\d{4}/)[0]))
            .toBeLessThan(WEEK_MS);
        expect(within(details).getByText('Active days').closest('li')).toHaveTextContent('about 0');
    });
});
