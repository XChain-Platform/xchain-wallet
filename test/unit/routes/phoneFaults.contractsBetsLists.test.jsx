// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import contractStyles from '../../../packages/core/src/shared/routes/ContractScreens.module.css';

const here = dirname(fileURLToPath(import.meta.url));
const route = (name) => readFileSync(resolve(here, '../../../packages/core/src/shared/routes', name), 'utf8');

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('MyLists load failure wording', () => {
    it('names the chain without API paths or HTTP codes', async () => {
        const raw = 'Explorer returned HTTP 429 for /BTC/api/lists/tb1qexample/address';
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                'bitcoin-testnet': [{ address: 'tb1qexampleaddress0000000000000000000000' }],
            }),
            getListsForSource: vi.fn().mockRejectedValue(new Error(raw)),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MyLists walletId="w1" onOpenList={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );

        const msg = await screen.findByText(/Couldn't load your lists for/, {}, { timeout: 10_000 });
        expect(msg.textContent).not.toMatch(/HTTP|429|\/api\/|Explorer returned/);
        expect(msg.textContent).toMatch(/Try again in a moment/);
    }, 20_000);
});

describe('BetFeedsList market cards', () => {
    it('opens the market when its card is pressed', async () => {
        const onOpenMarket = vi.fn();
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                'bitcoin-testnet': [{ address: 'tb1qexampleaddress0000000000000000000000' }],
            }),
            betFeeds: vi.fn().mockResolvedValue({
                data: [{ action_index: 7, tick: 'XCHAIN', label: 'Who wins', outcomes: 'a,b', feed_status: 'open' }],
            }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BetFeedsList walletId="w1" onOpenMarket={onOpenMarket} onBack={() => {}} />
            </MessagingProvider>,
        );
        const card = await screen.findByText('Who wins', {}, { timeout: 10_000 });
        fireEvent.click(card);
        expect(onOpenMarket).toHaveBeenCalledTimes(1);
        expect(onOpenMarket.mock.calls[0][1]).toBe(7);
    }, 20_000);

    it('says which status filter is on, not only by colour', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                'bitcoin-testnet': [{ address: 'tb1qexampleaddress0000000000000000000000' }],
            }),
            betFeeds: vi.fn().mockResolvedValue({ data: [] }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BetFeedsList walletId="w1" onOpenMarket={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );
        const taking = await screen.findByRole('button', { name: 'Taking bets' }, { timeout: 10_000 });
        const every = screen.getByRole('button', { name: 'All markets' });
        expect(taking.getAttribute('aria-pressed')).toBe('true');
        expect(every.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(every);
        expect(taking.getAttribute('aria-pressed')).toBe('false');
        expect(every.getAttribute('aria-pressed')).toBe('true');
    }, 20_000);
});

describe('ContractsList filter field sizing', () => {
    it.each([320, 360])('contains an unbroken contract name at %ipx', async (viewportWidth) => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
        const contractName = 'A'.repeat(64);
        const row = {
            action_index: 42,
            meta_name: contractName,
            source: 'bc1qexampleexampleexampleexampleexampleex',
            status: 'active',
            block_index: 100,
        };
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                'bitcoin-mainnet': [{ address: row.source }],
            }),
            getContractsForSource: vi.fn().mockResolvedValue({ data: [row] }),
            getDepositsForAddress: vi.fn().mockResolvedValue({ data: [] }),
            getWithdrawalsForAddress: vi.fn().mockResolvedValue({ data: [] }),
            getContractsBrowseAll: vi.fn().mockResolvedValue({ data: [] }),
        };

        try {
            render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <ContractsList
                        walletId="w1"
                        onOpenContract={() => {}}
                        onDeploy={() => {}}
                        onBack={() => {}}
                    />
                </MessagingProvider>,
            );

            const card = await screen.findByRole('button', { name: new RegExp(`^${contractName}`) });
            expect(card).toHaveClass(contractStyles.contractRow);
            expect(card).toHaveTextContent(contractName);
            expect(screen.getByRole('tablist', { name: 'Chain filter' }))
                .toHaveClass(contractStyles.chainFilters);
        } finally {
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
        }
    });

    it('puts the flex basis on a wrapper, never on the input itself', () => {
        const source = route('ContractsList.jsx');
        expect(source).not.toMatch(/aria-label="Filter contracts"\s*\n\s*style=/);
        expect(source).toMatch(/<div className=\{contractStyles\.toolbarSearch\}>\s*\n\s*<Input/);
        expect(source).toMatch(/className=\{`\$\{styles\.entry\} \$\{contractStyles\.contractRow\}`\}/);
    });
});
