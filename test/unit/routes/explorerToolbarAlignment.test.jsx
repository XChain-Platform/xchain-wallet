// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import betStyles from '../../../packages/core/src/shared/routes/BetFeedsList.module.css';
import { DispenserExplorer } from '../../../packages/core/src/shared/routes/DispenserExplorer.jsx';
import dispenserStyles from '../../../packages/core/src/shared/routes/DispenserExplorer.module.css';
import { SharedListDirectory } from '../../../packages/core/src/shared/routes/SharedListDirectory.jsx';
import sharedListStyles from '../../../packages/core/src/shared/routes/SharedListDirectory.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import chainPickerStyles from '../../../packages/core/src/ui/ChainPicker.module.css';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';
import tabsStyles from '../../../packages/core/src/ui/Tabs.module.css';

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

        // The body is one search field; Network sits behind the title-bar filter icon.
        const form = container.querySelector(`.${dispenserStyles.searchForm}`);
        const search = within(form).getByRole('searchbox', { name: 'Search a token or seller address' });
        expect(within(form).getByRole('button', { name: 'Search' })).toBeTruthy();
        expect(fieldFor(search)).toHaveClass(inputStyles.md);

        fireEvent.click(screen.getByRole('button', { name: 'Filter dispensers' }));
        const select = screen.getByRole('combobox', { name: 'Network' });
        expect(fieldFor(select)).toHaveClass(inputStyles.md);
        // Chain options name the chain without the network word.
        for (const option of within(select).getAllByRole('option')) {
            expect(option.textContent).not.toMatch(/mainnet|testnet|regtest/i);
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

        const search = await screen.findByRole('searchbox', { name: 'Search shared lists' });
        expect(search.closest(`.${sharedListStyles.filterRow}`)).toBeTruthy();
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
        expect(within(actions).getByRole('tablist')).toHaveClass(tabsStyles.tabs);
        for (const action of within(actions).getAllByRole('tab')) {
            expect(action).toHaveClass(tabsStyles.tab);
        }
    });
});
