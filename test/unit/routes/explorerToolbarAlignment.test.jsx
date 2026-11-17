// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import balanceStyles from '../../../packages/core/src/shared/components/BalanceList.module.css';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import betStyles from '../../../packages/core/src/shared/routes/BetFeedsList.module.css';
import { DispenserExplorer } from '../../../packages/core/src/shared/routes/DispenserExplorer.jsx';
import dispenserStyles from '../../../packages/core/src/shared/routes/DispenserExplorer.module.css';
import { SharedListDirectory } from '../../../packages/core/src/shared/routes/SharedListDirectory.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import chainPickerStyles from '../../../packages/core/src/ui/ChainPicker.module.css';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';
import tabsStyles from '../../../packages/core/src/ui/Tabs.module.css';
import toggleStyles from '../../../packages/core/src/ui/SegmentedControl.module.css';

const CHAIN = 'bitcoin-mainnet';

afterEach(cleanup);

function fieldFor(control) {
    return control.closest(`.${inputStyles.field}`);
}

describe('explorer toolbar control alignment', () => {
    it('gives the dispenser filter row one shared medium control size', () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ schemaVersion: 2, activeNetwork: 'mainnet' }),
            getDispensersForToken: vi.fn(),
            getDispensersForAddress: vi.fn(),
        };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DispenserExplorer onOpenDispenser={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );

        // The search box and Network both sit behind the title-bar filter
        // icon (G04); the search submits on Enter, with no separate button.
        expect(container.querySelector(`.${dispenserStyles.searchForm}`)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Filter dispensers' }));
        const filter = screen.getByRole('dialog', { name: 'Filter dispensers' });
        const search = within(filter).getByRole('searchbox', { name: 'Search a token or seller address' });
        expect(fieldFor(search)).toHaveClass(inputStyles.md);

        // Network is the standard Network field at md; it opens the
        // full-screen network list (operator ruling 2026-11-13).
        const network = screen.getByRole('button', { name: /^Network: / });
        expect(network.closest(`.${chainPickerStyles.wrap}`)).toHaveClass(chainPickerStyles.md);
        fireEvent.click(network);
        const rows = within(screen.getByRole('dialog', { name: 'Network' }))
            .getAllByRole('button', { name: /^Select / });
        expect(rows.length).toBeGreaterThan(0);
        // Each row's name is the chain alone; the network kind sits only on
        // the description line under it.
        for (const row of rows) {
            const name = row.querySelector(`.${balanceStyles.name}`);
            expect(name.textContent).not.toMatch(/mainnet|testnet|regtest/i);
        }
    });

    it('gives the shared-list search the medium toolbar size', async () => {
        const messaging = {
            getSharedLists: vi.fn().mockResolvedValue({ lists: [], unavailable: [] }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SharedListDirectory
                    walletId="wallet-1"
                    chainId={CHAIN}
                    mode="browse"
                    onSelect={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        // The search sits in the title bar filter panel (G95), not above the list.
        await screen.findByText('No shared lists yet');
        expect(screen.queryByRole('searchbox', { name: 'Search shared lists' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Filter shared lists' }));
        const search = within(screen.getByRole('dialog', { name: 'Filter shared lists' }))
            .getByRole('searchbox', { name: 'Search shared lists' });
        expect(fieldFor(search)).toHaveClass(inputStyles.md);
    });

    it('gives the betting network and tab row one shared medium control size', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: 'bc1qexample' }] }),
            betFeeds: vi.fn().mockResolvedValue({ data: [] }),
        };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BetFeedsList
                    walletId="wallet-1"
                    onOpenMarket={() => {}}
                    onCreate={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        await waitFor(() => expect(container.querySelector(`.${betStyles.toolbarRow}`)).toBeTruthy());
        const row = container.querySelector(`.${betStyles.toolbarRow}`);
        const actions = container.querySelector(`.${betStyles.toolbarActions}`);

        // The network is a Settings choice, so the row holds only the view tabs.
        expect(within(row).queryByRole('button', { name: /^Network:/ })).toBeNull();
        // Tabs draw the shared view-toggle frame and items.
        expect(within(actions).getByRole('tablist')).toHaveClass(toggleStyles.segmented);
        for (const action of within(actions).getAllByRole('tab')) {
            expect(action).toHaveClass(tabsStyles.tab);
            expect(action).toHaveClass(toggleStyles.segment);
        }
    });
});
