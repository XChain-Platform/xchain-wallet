// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Settings > Appearance > Hide Small Balances (operator ruling 2026-11-14):
// the switch, then an Options | Hidden balances toggle that is always shown,
// a fiat amount, and a live preview of the wallet's balances judged by the
// same rule Home folds with.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
    createDefaultSettings,
    resolveSmallBalanceFiat,
    validateSettings,
} from '../../../packages/core/src/schemas/settings.js';
import { writeBalanceCache } from '../../../packages/core/src/shared/utils/balanceCache.js';

const { messagingState } = vi.hoisted(() => ({
    messagingState: { current: null },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging: messagingState.current }),
}));

let HideSmallBalancesPage;
let smallBalancesSummary;

const WALLET = 'w-small';
const ACCOUNT = 'a-small';

function harness(initial, { escrow = [] } = {}) {
    let stored = initial;
    const messaging = {
        getSettings: vi.fn(async () => structuredClone(stored)),
        updateSettings: vi.fn(async (patch) => {
            stored = {
                ...stored,
                ...patch,
                privacy: { ...stored.privacy, ...(patch.privacy || {}) },
            };
            return structuredClone(stored);
        }),
        // Home's open-offer escrow read, one call per shown address.
        getEscrowedTokens: vi.fn(async () => ({ rows: escrow })),
    };
    messagingState.current = messaging;
    return { messaging, stored: () => stored };
}

function settingsWith({ on = false, amount, legacy } = {}) {
    const s = createDefaultSettings();
    s.privacy.hideSmallBalances = on;
    if (amount === undefined) delete s.smallBalanceFiat;
    else s.smallBalanceFiat = amount;
    if (legacy !== undefined) s.smallBalanceThreshold = legacy;
    return s;
}

// BTC 0.5 at 90,000 (45,000), PEPE 0.5 tokens at 1 (0.50), DUST 10 tokens at
// 0.2 (2.00), NOPRICE with no price, ZERO with nothing held.
//
// `fromStore` saves the balances unpriced, as a real balance read is, and
// puts the prices in the rate store's saved copy, where Home's last price
// refresh leaves them; the page must price the rows from there.
const RATES = { BTC: 90000, PEPE: 1, DUST: 0.2, ZERO: 5 };

function cacheBalances({ extraTokens = 0, fromStore = false } = {}) {
    const rateOf = (tick, rate) => (fromStore ? {} : { fiatRate: rate });
    const tokens = [
        { tick: 'PEPE', divisibility: 8, quantity: '50000000', ...rateOf('PEPE', RATES.PEPE) },
        { tick: 'DUST', divisibility: 8, quantity: '1000000000', ...rateOf('DUST', RATES.DUST) },
        { tick: 'NOPRICE', divisibility: 8, quantity: '1' },
        { tick: 'ZERO', divisibility: 8, quantity: '0', ...rateOf('ZERO', RATES.ZERO) },
    ];
    const extraRates = {};
    for (let i = 0; i < extraTokens; i += 1) {
        tokens.push({ tick: `T${i}`, divisibility: 0, quantity: '1', ...rateOf(`T${i}`, 100) });
        extraRates[`T${i}`] = 100;
    }
    writeBalanceCache(WALLET, ACCOUNT, {
        balances: {
            'bitcoin-mainnet': [{
                address: 'bc1qexampleaddress',
                balances: { native: { tick: 'BTC', divisibility: 8, quantity: '50000000', ...rateOf('BTC', RATES.BTC) }, tokens },
            }],
        },
        activeByChain: {},
        fetchedAt: Date.now(),
    }, 'mainnet');
    if (fromStore) {
        const fetchedAt = new Date().toISOString();
        const tokenRates = { PEPE: RATES.PEPE, DUST: RATES.DUST, ZERO: RATES.ZERO, ...extraRates };
        localStorage.setItem('xchain-wallet:fiat-rates:v1', JSON.stringify({
            version: 1,
            rates: [
                { rate: RATES.BTC, chainCoin: 'bitcoin', fiatCurrency: 'USD', source: 'oracle', fetchedAt },
                ...Object.entries(tokenRates).map(([tick, rate]) => ({
                    rate, chainCoin: 'bitcoin', tick, fiatCurrency: 'USD', source: 'market', fetchedAt,
                })),
            ],
        }));
    }
}

async function renderPage(settings, options) {
    const h = harness(settings, options);
    render(<HideSmallBalancesPage walletId={WALLET} accountId={ACCOUNT} />);
    await screen.findByRole('switch', { name: 'Hide small balances' });
    return h;
}

const tabs = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const smallRows = () => [...document.querySelectorAll('[data-small-balance-row][data-small="true"]')]
    .map((el) => el.getAttribute('data-small-balance-row'));

beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    ({ HideSmallBalancesPage, smallBalancesSummary } = await import(
        '../../../packages/core/src/shared/components/settings/HideSmallBalancesPage.jsx'
    ));
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    messagingState.current = null;
});

describe('Hide Small Balances page', () => {
    it('shows the switch and both tabs with the switch off, and nothing appears or vanishes when it turns on', async () => {
        cacheBalances();
        const h = await renderPage(settingsWith({ on: false, amount: '1' }));
        const sw = screen.getByRole('switch', { name: 'Hide small balances' });
        expect(sw.checked).toBe(false);
        expect(tabs()).toEqual(['Options', 'Hidden balances']);
        expect(screen.getByTestId('small-balance-amount')).toBeTruthy();

        await act(async () => { fireEvent.click(sw); });
        await waitFor(() => expect(h.stored().privacy.hideSmallBalances).toBe(true));
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Hide small balances' }).checked).toBe(true));
        expect(tabs()).toEqual(['Options', 'Hidden balances']);
        expect(screen.getByTestId('small-balance-amount')).toBeTruthy();

        // The preview lists the same rows either way; only the tag's word changes.
        fireEvent.click(screen.getByRole('tab', { name: 'Hidden balances' }));
        const rowsOn = smallRows();
        expect(screen.getAllByText('Hidden').length).toBe(rowsOn.length);
        await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Hide small balances' })); });
        await waitFor(() => expect(h.stored().privacy.hideSmallBalances).toBe(false));
        await waitFor(() => expect(screen.getAllByText('Would hide').length).toBe(rowsOn.length));
        expect(smallRows()).toEqual(rowsOn);
        expect(tabs()).toEqual(['Options', 'Hidden balances']);
    });

    it('greys and tags the rows worth less than the amount, never the unpriced one, and zero always', async () => {
        cacheBalances();
        await renderPage(settingsWith({ on: true, amount: '1' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Hidden balances' }));
        expect(smallRows().sort()).toEqual(['bitcoin-mainnet:PEPE', 'bitcoin-mainnet:ZERO']);
        expect(screen.getByText(/2 of 5 balances fold away on Home/)).toBeTruthy();
        const noPrice = document.querySelector('[data-small-balance-row="bitcoin-mainnet:NOPRICE"]');
        expect(noPrice.getAttribute('data-small')).toBe('false');
    });

    it('prices unpriced balances from the rates Home already loaded, fetching none', async () => {
        cacheBalances({ fromStore: true });
        const fetchSpy = vi.fn(async () => { throw new Error('no network in this test'); });
        vi.stubGlobal('fetch', fetchSpy);
        await renderPage(settingsWith({ on: true, amount: '1' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Hidden balances' }));
        // The same verdicts as rows that carry their own price: the coin and
        // token rate keys match the ones Home's lists price with.
        expect(smallRows().sort()).toEqual(['bitcoin-mainnet:PEPE', 'bitcoin-mainnet:ZERO']);
        expect(document.querySelector('[data-small-balance-row="bitcoin-mainnet:DUST"]').getAttribute('data-small')).toBe('false');
        expect(document.querySelector('[data-small-balance-row="bitcoin-mainnet:BTC"]').getAttribute('data-small')).toBe('false');
        expect(fetchSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('keeps a pinned balance out of the hidden ones', async () => {
        cacheBalances();
        const s = settingsWith({ on: true, amount: '1' });
        s.pinnedTokensByWallet = { [WALLET]: ['bitcoin-mainnet:PEPE'] };
        await renderPage(s);
        fireEvent.click(screen.getByRole('tab', { name: 'Hidden balances' }));
        expect(smallRows()).toEqual(['bitcoin-mainnet:ZERO']);
    });

    it('keeps a token held in an open offer listed, as Home does', async () => {
        cacheBalances();
        await renderPage(settingsWith({ on: true, amount: '1' }), {
            escrow: [{ tick: 'ZERO', amount: '3' }],
        });
        fireEvent.click(screen.getByRole('tab', { name: 'Hidden balances' }));
        await waitFor(() => expect(smallRows()).toEqual(['bitcoin-mainnet:PEPE']));
    });

    it('updates the preview live as the amount is typed', async () => {
        cacheBalances();
        const h = await renderPage(settingsWith({ on: true, amount: '1' }));
        const field = screen.getByTestId('small-balance-amount');
        expect(field.value).toBe('1.00');
        // Typing, not yet saved: DUST (2.00) now counts too.
        fireEvent.change(field, { target: { value: '3' } });
        fireEvent.mouseDown(screen.getByRole('tab', { name: 'Hidden balances' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Hidden balances' }));
        expect(smallRows().sort()).toEqual(['bitcoin-mainnet:DUST', 'bitcoin-mainnet:PEPE', 'bitcoin-mainnet:ZERO']);
        // Back on Options the typed amount is still there, and a blur saves it.
        fireEvent.click(screen.getByRole('tab', { name: 'Options' }));
        const again = screen.getByTestId('small-balance-amount');
        expect(again.value).toBe('3');
        await act(async () => { fireEvent.blur(again); });
        await waitFor(() => expect(h.stored().smallBalanceFiat).toBe('3'));
        expect(screen.getByTestId('small-balance-amount').value).toBe('3.00');
    });

    it('refuses an amount that is not a positive two-decimal number and keeps the stored one', async () => {
        cacheBalances();
        const h = await renderPage(settingsWith({ on: true, amount: '1' }));
        const field = screen.getByTestId('small-balance-amount');
        fireEvent.change(field, { target: { value: '0' } });
        await act(async () => { fireEvent.blur(field); });
        expect(screen.getByText(/Enter an amount above zero/)).toBeTruthy();
        expect(h.messaging.updateSettings).not.toHaveBeenCalled();
    });

    it('says where the balances come from when Home has not saved any', async () => {
        await renderPage(settingsWith({ on: true, amount: '1' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Hidden balances' }));
        expect(screen.getByText('Your balances show here once Home has loaded them.')).toBeTruthy();
    });
});

describe('old coin-unit setting', () => {
    it('reads a record with only the old threshold as one dollar, and the record still validates', async () => {
        const legacy = settingsWith({ on: true, legacy: '0.01' });
        expect(legacy.smallBalanceFiat).toBeUndefined();
        expect(resolveSmallBalanceFiat(legacy)).toBe('1');
        expect(validateSettings(legacy).ok).toBe(true);
        for (const old of ['dust', '0.0001', '0.01', '1']) {
            expect(resolveSmallBalanceFiat(settingsWith({ legacy: old }))).toBe('1');
        }
        expect(smallBalancesSummary(legacy)).toBe('Under $1.00');
        cacheBalances();
        await renderPage(legacy);
        expect(screen.getByTestId('small-balance-amount').value).toBe('1.00');
    });

    it('rejects a malformed stored amount and reads it as the default', () => {
        const bad = settingsWith({ amount: '-3' });
        expect(validateSettings(bad).ok).toBe(false);
        expect(resolveSmallBalanceFiat(bad)).toBe('1');
        expect(resolveSmallBalanceFiat(settingsWith({ amount: '2.5' }))).toBe('2.5');
        expect(smallBalancesSummary(settingsWith({ on: false, amount: '2.5' }))).toBe('Off');
    });
});

describe('preview reads', () => {
    // The page makes one local read of Home's saved balances, one of the
    // saved rates, and no network read, however many rows the wallet holds.
    // The extra rows are unpriced balances, so each one goes through the
    // token-rate lookup.
    async function countReads(extraTokens) {
        vi.resetModules();
        ({ HideSmallBalancesPage } = await import(
            '../../../packages/core/src/shared/components/settings/HideSmallBalancesPage.jsx'
        ));
        cacheBalances({ extraTokens, fromStore: true });
        const getItem = vi.spyOn(Storage.prototype, 'getItem');
        const fetchSpy = vi.fn(async () => { throw new Error('no network in this test'); });
        vi.stubGlobal('fetch', fetchSpy);
        const h = await renderPage(settingsWith({ on: true, amount: '1' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Hidden balances' }));
        await waitFor(() => expect(document.querySelectorAll('[data-small-balance-row]').length).toBe(5 + extraTokens));
        const keys = getItem.mock.calls.map(([key]) => String(key));
        const result = {
            cacheReads: keys.filter((key) => key.startsWith('xc:balanceCache')).length,
            rateReads: keys.filter((key) => key.startsWith('xchain-wallet:fiat-rates')).length,
            fetches: fetchSpy.mock.calls.length,
            messagingCalls: Object.values(h.messaging).reduce((n, fn) => n + fn.mock.calls.length, 0),
            small: smallRows().sort(),
        };
        cleanup();
        vi.unstubAllGlobals();
        getItem.mockRestore();
        localStorage.clear();
        return result;
    }

    it('does not grow with the number of rows', async () => {
        const few = await countReads(0);
        const many = await countReads(40);
        expect(few.cacheReads).toBe(1);
        expect(few.rateReads).toBe(1);
        expect(few.fetches).toBe(0);
        // The store priced every row: only the 0.50 token and the zero fold.
        expect(few.small).toEqual(['bitcoin-mainnet:PEPE', 'bitcoin-mainnet:ZERO']);
        expect(many).toEqual(few);
    });
});
