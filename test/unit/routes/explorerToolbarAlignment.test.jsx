// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

        const row = container.querySelector(`.${dispenserStyles.filterRow}`);
        const select = within(row).getByRole('combobox', { name: 'Network' });
        const search = within(row).getByRole('textbox', { name: 'Token ticker' });
        const action = within(row).getByRole('button', { name: 'Search' });

        expect(fieldFor(select)).toHaveClass(inputStyles.md);
        expect(fieldFor(search)).toHaveClass(inputStyles.md);
        // Chain options name the chain without the network word.
        for (const option of within(select).getAllByRole('option')) {
            expect(option.textContent).not.toMatch(/mainnet|testnet|regtest/i);
        }
        expect(action).toHaveClass(buttonStyles.md);
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

    it('gives the betting network and action row one shared medium control size', async () => {
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
        const network = within(row).getByRole('button', { name: /^Network:/ });
        const actions = container.querySelector(`.${betStyles.toolbarActions}`);

        expect(network.closest(`.${chainPickerStyles.wrap}`)).toHaveClass(chainPickerStyles.md);
        for (const action of within(actions).getAllByRole('button')) {
            expect(action).toHaveClass(buttonStyles.md);
        }
    });
});
