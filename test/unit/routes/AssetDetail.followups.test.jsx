// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one asset page (operator ruling 2026-11-15), its follow-ups:
//   * a coin on a test network has no price, so its blue hero charts the
//     balance the wallet's own rows prove, as a token does (G10: a blue hero
//     always has a chart);
//   * a balance line (or its value at today's price) has no change pill, since
//     a receive is not a gain; only a price line carries one;
//   * the issuer's Destroy, Dispenser and Airdrop stay locked with "needs a
//     balance" when the wallet holds none of the token;
//   * both route ids are titled with the asset's name, else "Token".

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../packages/core/src/flows/demoMode.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isDemoWallet: () => false };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import { documentTitleFor, useDocumentTitle } from '../../../packages/core/src/shared/hooks/useDocumentTitle.js';
import { buildTokenOwnerGroups } from '../../../packages/core/src/shared/components/TokenOwnerActions.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const MAINNET = 'bitcoin-mainnet';
const REGTEST = 'bitcoin-regtest';
const MINE = 'bcrt1qminemineminemineminemineminemine00';
const OTHER = 'bcrt1qotherotherotherotherotherother000';
const HOUR = 3600;
const DAY = 24 * HOUR;

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

const CHANGE_PILL = /^(24h|1W|1M|3M|6M|1Y|YTD|All) change\. /;

function coinRows(nowSec, count = 1) {
    // The newest row is a receive of 0.5 BTC two days ago; any older ones are
    // receives of 0.01 BTC an hour apart before it.
    const rows = [
        { action_index: '500.1', action: 'SEND', tick: 'BTC', amount: '0.5', source: OTHER, destination: MINE, timestamp: nowSec - 2 * DAY, block_index: 500 },
    ];
    for (let i = 1; i < count; i += 1) {
        rows.push({ action_index: `${500 - i}.1`, action: 'SEND', tick: 'BTC', amount: '0.01', source: OTHER, destination: MINE, timestamp: nowSec - 2 * DAY - i * HOUR, block_index: 500 - i });
    }
    return rows;
}

function testnetCoinMessaging({ rows = coinRows(Math.floor(Date.now() / 1000)) } = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest', fiatCurrency: 'USD' }),
        getNativePricesRequest: vi.fn().mockResolvedValue({ prices: {} }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [REGTEST]: [{ address: MINE }] }),
        getAddressHistory: vi.fn().mockResolvedValue(rows),
    };
}

function renderTestnetCoin(messaging = testnetCoinMessaging(), { divisibility = 8 } = {}) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId="w1"
                chainId={REGTEST}
                tick="BTC"
                kind="native"
                displayName="Bitcoin"
                quantity="150000000"
                divisibility={divisibility}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

function tokenMessaging({ chainId = REGTEST, network = 'regtest', balance = '5' } = {}) {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: network, fiatCurrency: 'USD' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            creator: MINE,
            displayName: 'MYTOKEN',
            description: 'A token of my own.',
            totalSupply: '10',
            maxSupply: '100',
            divisibility: 0,
            locks: {},
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [{ address: MINE }] }),
        getAddressHistory: vi.fn().mockResolvedValue([
            { action_index: '300.1', action: 'SEND', tick: 'MYTOKEN', amount: '2', source: OTHER, destination: MINE, timestamp: nowSec - 2 * HOUR, block_index: 300 },
        ]),
        getGenesisForToken: vi.fn().mockResolvedValue({ source: MINE, block_index: 50 }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({
            [chainId]: { [MINE]: { tokens: [{ tick: 'MYTOKEN', quantity: balance }] } },
        }),
    };
}

function TitleProbe({ view }) {
    useDocumentTitle({ statusState: 'unlocked', unlockedView: view });
    return null;
}

describe('a coin on a test network', () => {
    it('charts its balance from the wallet rows, so its blue hero has a chart and range buttons', async () => {
        const messaging = renderTestnetCoin();
        const hero = await screen.findByRole('region', { name: 'Bitcoin' });
        const stack = hero.closest('[class*="heroStack"]');
        expect(stack?.className).toMatch(/heroStackWithChart/);
        const chart = await screen.findByRole('region', { name: 'Balance chart' });
        expect(stack.contains(chart)).toBe(true);
        expect(chart.getAttribute('data-series-kind')).toBe('balance');
        // 1W: 1.0 BTC before the 0.5 BTC receive two days ago; the line ends at 1.5.
        const line = await within(chart).findByRole('img', { name: /^Balance trend/ });
        expect(line.getAttribute('aria-label') || line.textContent).toMatch(/End 1\.5\b/);
        expect(line.getAttribute('aria-label') || line.textContent).toMatch(/Start 1 BTC\. End 1\.5 BTC\./);
        const ranges = screen.getByRole('tablist', { name: 'Chart range' });
        expect(ranges.className).not.toMatch(/rangesIdle/);
        // No price is asked for on a test network.
        expect(messaging.getNativePricesRequest).not.toHaveBeenCalled();
    });

    it('reads the rows once for the hero line and the History tab, the same reads at 1 and 20 rows', async () => {
        const readsAt = async (count) => {
            const messaging = renderTestnetCoin(testnetCoinMessaging({ rows: coinRows(Math.floor(Date.now() / 1000), count) }));
            await screen.findByRole('region', { name: 'Balance chart' });
            fireEvent.click(screen.getByRole('tab', { name: 'History' }));
            const panel = await waitFor(() => {
                const found = screen.getAllByRole('tabpanel')
                    .find((node) => /-tab-history$/.test(node.getAttribute('aria-labelledby') || ''));
                expect(found).toBeTruthy();
                return found;
            });
            await waitFor(() => expect(within(panel).getAllByRole('listitem')).toHaveLength(count));
            expect(messaging.getAddressHistory).toHaveBeenCalledTimes(1);
            const reads = Object.fromEntries(Object.entries(messaging).map(([name, fn]) => [name, fn.mock.calls.length]));
            cleanup();
            __clearTokenInfoCache();
            return reads;
        };
        const few = await readsAt(1);
        const many = await readsAt(20);
        expect(many).toEqual(few);
    });

    it('takes the chain\'s decimals when the row did not carry its divisibility', async () => {
        renderTestnetCoin(testnetCoinMessaging(), { divisibility: null });
        const chart = await screen.findByRole('region', { name: 'Balance chart' });
        const line = await within(chart).findByRole('img', { name: /^Balance trend/ });
        // Read in whole BTC, the 0.5 receive steps the line (never a flat line at 0 units).
        expect(line.getAttribute('aria-label') || line.textContent).toMatch(/Start 1 BTC\. End 1\.5 BTC\./);
    });
});

describe('the change pill', () => {
    it('is left off a balance line', async () => {
        render(
            <MessagingProvider shell="web" messaging={tokenMessaging()}>
                <TokenDetail walletId="w1" chainId={REGTEST} tick="MYTOKEN" quantity="5" divisibility={0} onBack={() => {}} />
            </MessagingProvider>,
        );
        const chart = await screen.findByRole('region', { name: 'Balance chart' });
        await within(chart).findByRole('img', { name: /^Balance trend/ });
        expect(screen.queryByLabelText(CHANGE_PILL)).toBeNull();
    });

    it('is left off a coin\'s balance line on a test network', async () => {
        renderTestnetCoin();
        const chart = await screen.findByRole('region', { name: 'Balance chart' });
        await within(chart).findByRole('img', { name: /^Balance trend/ });
        expect(screen.queryByLabelText(CHANGE_PILL)).toBeNull();
    });

    it('is left off a value line (the balance at today\'s price)', async () => {
        render(
            <MessagingProvider shell="web" messaging={tokenMessaging({ chainId: MAINNET, network: 'mainnet' })}>
                <TokenDetail walletId="w1" chainId={MAINNET} tick="MYTOKEN" quantity="5" divisibility={0} fiatRate={2} onBack={() => {}} />
            </MessagingProvider>,
        );
        const chart = await screen.findByRole('region', { name: 'Value chart' });
        await within(chart).findByRole('img', { name: /^Value trend/ });
        expect(screen.queryByLabelText(CHANGE_PILL)).toBeNull();
    });

    it('stays on a coin\'s price line', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'USD' }),
            getNativePricesRequest: vi.fn().mockImplementation(async (request) => ({
                prices: {
                    [MAINNET]: request.includeHistory ? { historyDaily: [] } : {
                        priceFiat: 40000,
                        change24hPct: 1.5,
                        sparkline: Array.from({ length: 168 }, (_, i) => 39000 + i * 5),
                        fetchedAt: Date.now(),
                    },
                },
            })),
            getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET]: [] }),
            getAddressHistory: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail walletId="w1" chainId={MAINNET} tick="BTC" kind="native" displayName="Bitcoin" quantity="200000000" divisibility={8} fiatRate={40000} onBack={() => {}} />
            </MessagingProvider>,
        );
        expect(await screen.findByRole('region', { name: 'Price chart' })).toBeTruthy();
        expect(await screen.findByLabelText(CHANGE_PILL)).toBeTruthy();
    });
});

describe('the issuer\'s actions that spend the token', () => {
    const base = {
        assetInfo: { locks: {} },
        sleepState: { paused: false },
        owner: MINE,
        handlers: {
            onDestroy: () => {},
            onCreateDispenser: () => {},
            onAirdrop: () => {},
            onMint: () => {},
        },
    };
    const byId = (groups) => Object.fromEntries(groups.flatMap((group) => group.actions).map((action) => [action.id, action]));

    it('lock Destroy, Dispenser and Airdrop with the balance reason when none is held', () => {
        const actions = byId(buildTokenOwnerGroups({ ...base, noBalanceReason: 'Needs a balance of MYTOKEN.' }));
        for (const id of ['destroy', 'dispenser', 'airdrop']) {
            expect(actions[id].disabled, id).toBe(true);
            expect(actions[id].reason, id).toBe('Needs a balance of MYTOKEN.');
            expect(actions[id].onSelect, id).toBeUndefined();
        }
        // Mint makes the token, so it needs none.
        expect(actions.mint.disabled).toBe(false);
    });

    it('leave them open with a balance or while the balance is unknown', () => {
        const actions = byId(buildTokenOwnerGroups({ ...base, noBalanceReason: null }));
        for (const id of ['destroy', 'dispenser', 'airdrop']) expect(actions[id].disabled, id).toBe(false);
    });

    it('read a watch-only or offline reason before the balance reason', () => {
        const actions = byId(buildTokenOwnerGroups({ ...base, blockedReason: 'Needs a signing wallet.', noBalanceReason: 'Needs a balance of MYTOKEN.' }));
        expect(actions.destroy.reason).toBe('Needs a signing wallet.');
    });

    it('show the reason on the page opened from My Tokens with none held', async () => {
        render(
            <MessagingProvider shell="web" messaging={tokenMessaging({ balance: '0' })}>
                <ManageToken
                    walletId="w1"
                    chainId={REGTEST}
                    tick="MYTOKEN"
                    quantity="0"
                    onBack={() => {}}
                    onDestroy={() => {}}
                    onCreateDispenser={() => {}}
                    onAirdrop={() => {}}
                    onMint={() => {}}
                />
            </MessagingProvider>,
        );
        await waitFor(() => expect(document.querySelector('[data-owner-group] [data-action-id="destroy"]')).not.toBeNull());
        for (const id of ['destroy', 'dispenser', 'airdrop']) {
            const row = document.querySelector(`[data-owner-group] [data-action-id="${id}"]`);
            expect(row.getAttribute('aria-disabled'), id).toBe('true');
            expect(row.textContent, id).toContain('Needs a balance of MYTOKEN.');
        }
        const mint = document.querySelector('[data-owner-group] [data-action-id="mint"]');
        await waitFor(() => expect(mint.getAttribute('aria-disabled')).not.toBe('true'));
    });
});

describe('the asset page title', () => {
    it('is "Token" in the route registry and the window title before an asset names it', () => {
        expect(ROUTE_REGISTRY['token-detail'].title).toBe('Token');
        expect(ROUTE_REGISTRY['manage-token'].title).toBe('Token');
        expect(documentTitleFor({ statusState: 'unlocked', unlockedView: 'token-detail' })).toBe('XChain Wallet - Token');
        expect(documentTitleFor({ statusState: 'unlocked', unlockedView: 'manage-token' })).toBe('XChain Wallet - Token');
    });

    it('names the asset in the window title on both routes', async () => {
        render(
            <MessagingProvider shell="web" messaging={tokenMessaging()}>
                <TitleProbe view="manage-token" />
                <ManageToken walletId="w1" chainId={REGTEST} tick="MYTOKEN" quantity="5" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(document.title).toBe('XChain Wallet - MYTOKEN'));
        cleanup();
        render(
            <MessagingProvider shell="web" messaging={testnetCoinMessaging()}>
                <TitleProbe view="token-detail" />
                <TokenDetail walletId="w1" chainId={REGTEST} tick="BTC" kind="native" displayName="Bitcoin" quantity="1" divisibility={8} onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(document.title).toBe('XChain Wallet - Bitcoin'));
    });
});
