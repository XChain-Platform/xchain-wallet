// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';
import { AlertsRoute } from '../../../packages/core/src/shared/routes/AlertsRoute.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import { OnboardingCarousel } from '../../../packages/core/src/shared/routes/OnboardingCarousel.jsx';
import {
    clearActiveWallet,
    writeActiveWallet,
} from '../../../packages/core/src/shared/utils/activeWalletMemory.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qheadingorderexample';

function renderRoute(route, messaging = {}) {
    return render(
        <MessagingProvider
            shell="web"
            messaging={{ getSettings: vi.fn().mockResolvedValue({}), ...messaging }}
        >
            {route}
        </MessagingProvider>,
    );
}

function expectOrderedHeadings(container) {
    const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const levels = headings.map((heading) => Number(heading.tagName.slice(1)));

    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (let index = 1; index < levels.length; index += 1) {
        expect(levels[index]).toBeLessThanOrEqual(levels[index - 1] + 1);
    }

    for (const list of container.querySelectorAll('[role="list"], ul, ol')) {
        expect(list.querySelector('h1, h2')).toBeNull();
    }
}

function actionEntry(overrides = {}) {
    return {
        key: `${CHAIN}:12:${ADDRESS}`,
        chainId: CHAIN,
        address: ADDRESS,
        actionIndex: '12',
        action: 'SEND',
        blockIndex: 100,
        timestamp: Date.now(),
        txHash: 'a'.repeat(64),
        source: ADDRESS,
        raw: { source: ADDRESS, destination: 'bc1qrecipient' },
        link: null,
        ...overrides,
    };
}

afterEach(() => {
    resetWalletModes();
    cleanup();
    clearActiveWallet();
});

describe('main route heading order', () => {
    it('keeps menu and list-card routes rooted at one h1', () => {
        const actions = renderRoute(
            <ActionsMenu entries={[{ id: 'mint', label: 'Mint', onSelect: vi.fn() }]} onBack={vi.fn()} />,
        );
        expectOrderedHeadings(actions.container);
        actions.unmount();

        const alerts = renderRoute(
            <AlertsRoute
                onBack={vi.fn()}
                alerts={[{ id: 'backup', severity: 'warning', title: 'Back up wallet', message: 'Keep a recovery copy.' }]}
            />,
        );
        expect(screen.getByRole('list')).toBeInTheDocument();
        expectOrderedHeadings(alerts.container);
    });

    it('keeps the Home h1 when signer mode replaces the standard body', async () => {
        const messaging = {
            // Wallet mode is a property of the wallet record.
            getSettings: vi.fn().mockResolvedValue({}),
            listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Wallet', walletMode: 'signer' }]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
        };
        const view = renderRoute(<Home activeWalletId="wallet-1" />, messaging);

        await screen.findByText('Signer for another phone');
        expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
        expectOrderedHeadings(view.container);
    });

    it('keeps the product name as the lock h1 and never shows the wallet name on a cold launch', async () => {
        writeActiveWallet('wallet-2');
        const locked = renderRoute(<Locked onUnlocked={vi.fn()} />, {
            unlockWallet: vi.fn(),
            listWallets: vi.fn().mockResolvedValue([
                { id: 'wallet-1', name: 'Personal' },
                { id: 'wallet-2', name: 'Treasury' },
            ]),
        });
        const heading = await screen.findByRole('heading', {
            level: 1,
            name: 'XChain Wallet',
            hidden: true,
        });
        expect(heading).toHaveClass('sr-only');
        expect(screen.queryByText('Treasury')).toBeNull();
        expectOrderedHeadings(locked.container);
    });

    it('shows the product name heading when there is no active wallet', () => {
        const locked = renderRoute(<Locked onUnlocked={vi.fn()} />, {
            unlockWallet: vi.fn(),
            listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Personal' }]),
        });
        const heading = screen.getByRole('heading', {
            level: 1,
            name: 'XChain Wallet',
            hidden: true,
        });
        expect(heading).toHaveClass('sr-only');
        expectOrderedHeadings(locked.container);
        locked.unmount();

        const onboarding = renderRoute(
            <OnboardingCarousel
                frames={[
                    { id: 'one', title: 'Own your keys', body: 'Your wallet stays under your control.' },
                    { id: 'two', title: 'Use every shell', body: 'The same wallet works across devices.' },
                ]}
                onDone={vi.fn()}
            />,
        );
        expect(screen.getByRole('heading', { level: 1, name: 'Own your keys' })).toBeInTheDocument();
        expectOrderedHeadings(onboarding.container);
    });

    it('keeps the page heading order on a populated My bets list', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            bets: vi.fn().mockResolvedValue({
                data: [
                    { action_index: '2', feed_action_index: '8', bet_status: 'open', outcome: 0, amount: '10', tick: 'XCHAIN' },
                    { action_index: '1', feed_action_index: '7', bet_status: 'won', outcome: 1, amount: '5', tick: 'XCHAIN' },
                ],
            }),
            betFeeds: vi.fn().mockResolvedValue({
                data: [
                    { action_index: '8', label: 'Market eight', outcomes: 'Yes,No', tick: 'XCHAIN', source: 'bc1qoracle' },
                    { action_index: '7', label: 'Market seven', outcomes: 'Yes,No', tick: 'XCHAIN', source: 'bc1qoracle' },
                ],
            }),
        };
        // My bets is the All list narrowed (ruling 2026-11-13): its cards
        // sit under the page title with no section headings of their own.
        const view = renderRoute(
            <BetFeedsList walletId="wallet-1" view="bets" onViewChange={vi.fn()} onOpenMarket={vi.fn()} onBack={vi.fn()} />,
            messaging,
        );

        await screen.findByRole('button', { name: 'Market eight' });
        expect(screen.getByRole('button', { name: 'Market seven' })).toBeInTheDocument();
        expectOrderedHeadings(view.container);
    });

    it('does not skip levels in pending and linked action details', async () => {
        const messaging = {
            listContacts: vi.fn().mockResolvedValue([]),
            getActionByIndex: vi.fn().mockResolvedValue({ action: 'SEND' }),
            verifyAction: vi.fn().mockResolvedValue({ status: 'verified' }),
        };
        const pending = renderRoute(
            <ActionDetail
                walletId="wallet-1"
                onBack={vi.fn()}
                entry={actionEntry({
                    key: `pending:${CHAIN}:${'b'.repeat(64)}`,
                    actionIndex: '',
                    blockIndex: 0,
                    txHash: 'b'.repeat(64),
                    raw: { data: `SEND|0|XCHAIN|10|${ADDRESS}|` },
                    pending: { origin: 'local', firstSeenMs: Date.now() },
                })}
            />,
            messaging,
        );
        await waitFor(() => expect(pending.container.querySelector('h2')).toBeTruthy());
        expectOrderedHeadings(pending.container);
        pending.unmount();

        const linked = renderRoute(
            <ActionDetail
                walletId="wallet-1"
                onBack={vi.fn()}
                entry={actionEntry({
                    link: {
                        peerChainId: 'litecoin-mainnet',
                        peerCoinTicker: 'LTC',
                        peerActionIndex: '9',
                    },
                })}
            />,
            messaging,
        );
        // Both views of the Actions | Details toggle keep the outline whole.
        await screen.findByRole('heading', { level: 2, name: 'Actions' });
        expectOrderedHeadings(linked.container);
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        await screen.findByRole('heading', { level: 2, name: 'Details' });
        expectOrderedHeadings(linked.container);
    });
});
