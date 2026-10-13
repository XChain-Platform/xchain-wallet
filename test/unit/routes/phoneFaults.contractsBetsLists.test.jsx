// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import { MyBets } from '../../../packages/core/src/shared/routes/MyBets.jsx';
import betStyles from '../../../packages/core/src/shared/routes/IssueTokenForm.module.css';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import contractStyles from '../../../packages/core/src/shared/routes/ContractScreens.module.css';

const here = dirname(fileURLToPath(import.meta.url));
const route = (name) => readFileSync(resolve(here, '../../../packages/core/src/shared/routes', name), 'utf8');

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('MyLists load failure wording', () => {
    it('shows an address load failure as a sentence', async () => {
        const raw = 'address database unavailable';
        const messaging = {
            getAddressesByChain: vi.fn().mockRejectedValue(new Error(raw)),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MyLists walletId="w1" onOpenList={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Failed to load addresses.')).toBeTruthy();
        expect(screen.queryByText(raw)).toBeNull();
    });

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

describe('MyLists row sizing', () => {
    it('gives the list and its rows the full available width', () => {
        const css = route('MyLists.module.css');
        expect(css).toMatch(/\.list\s*{[^}]*\bwidth:\s*100%/s);
        expect(css).toMatch(/\.row\s*{[^}]*\bwidth:\s*100%/s);
    });
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

describe('bet screens at phone widths', () => {
    const chainId = 'bitcoin-testnet';
    const address = {
        id: 'address-1',
        address: 'tb1qthisisadeliberatelylongunbrokenbettoraddressforwrapping',
        publicKey: '02aabbcc',
        derivationPath: "m/84'/1'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    };
    const longLabel = 'WillThisDeliberatelyLongUnbrokenMarketNameWrapInsideTheAvailablePhoneWidth';
    const feed = {
        action_index: 7,
        source: 'tb1qoracleaddress',
        label: longLabel,
        outcomes: 'AnExtremelyLongOutcomeWithoutBreaks,AnotherLongOutcomeWithoutBreaks',
        tick: 'XCHAIN',
        fee: '1',
        deadline: Math.floor(Date.now() / 1000) + 3600,
        expire_at: Math.floor(Date.now() / 1000) + 7200,
        feed_status: 'open',
        pools: [{ outcome: 0, pool: '12345678901234567890.123456789', bet_count: 2 }],
        timeline: [],
    };

    function messaging() {
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [address] }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            betFeeds: vi.fn().mockResolvedValue({ data: [feed] }),
            betFeed: vi.fn().mockResolvedValue({ data: [feed] }),
            bets: vi.fn().mockResolvedValue({
                data: [{
                    action_index: 8,
                    feed_action_index: 7,
                    outcome: 0,
                    amount: '12345678901234567890.123456789',
                    tick: 'XCHAIN',
                    bet_status: 'open',
                }],
            }),
        };
        return new Proxy(target, {
            get(value, property) {
                if (property in value) return value[property];
                return vi.fn().mockResolvedValue({});
            },
        });
    }

    async function mountAtWidth(width, child) {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messaging()}>
                    {child}
                </MessagingProvider>,
            );
            for (let i = 0; i < 12; i += 1) await Promise.resolve();
        });
        return utils;
    }

    it.each([320, 360])('renders responsive hooks at %ipx', async (width) => {
        let utils = await mountAtWidth(width, (
            <BetFeedsList
                walletId="w1"
                onOpenMarket={() => {}}
                onCreate={() => {}}
                onMyBets={() => {}}
                onMyMarkets={() => {}}
                onBack={() => {}}
            />
        ));
        expect(await screen.findByText(longLabel)).toHaveClass(betStyles.betLongText);
        expect(utils.container.querySelector(`.${betStyles.betActions}`)).toBeTruthy();
        utils.unmount();

        utils = await mountAtWidth(width, (
            <BetFeedDetail walletId="w1" chainId={chainId} feedIndex="7" onBack={() => {}} />
        ));
        expect(await screen.findByRole('group', { name: 'Outcome to back' }))
            .toHaveClass(betStyles.betWagerChoices);
        expect(utils.container.querySelector(`.${betStyles.betOddsRow}`)).toBeTruthy();
        utils.unmount();

        utils = await mountAtWidth(width, (
            <CreateBetFeedForm walletId="w1" chainId={chainId} onBack={() => {}} />
        ));
        expect((await screen.findByLabelText('Outcome 0')).closest(`.${betStyles.betOutcomeRow}`)).toBeTruthy();
        utils.unmount();

        utils = await mountAtWidth(width, <MyBets walletId="w1" onBack={() => {}} />);
        expect(await screen.findByText(`from ${address.address}`)).toHaveClass(betStyles.betLongText);
        utils.unmount();
    }, 20_000);

    it('stacks wager, odds, authoring, and action rows below 400px', () => {
        const css = readFileSync(resolve(
            here,
            '../../../packages/core/src/shared/routes/IssueTokenForm.module.css',
        ), 'utf8');
        const narrow = css.slice(css.indexOf('@media not all and (min-width: 400px)'));

        expect(narrow).toMatch(/\.betActions,[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
        expect(narrow).toMatch(/\.betActions > \*,[\s\S]*width:\s*100%/);
        expect(narrow).toMatch(/\.betOddsRow,\s*\.betOutcomeRow\s*\{[^}]*flex-direction:\s*column/s);
        expect(narrow).toMatch(/\.betOutcomeRow > button\s*\{[^}]*width:\s*100%/s);
        expect(css).toMatch(/\.betLongText\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    });
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
