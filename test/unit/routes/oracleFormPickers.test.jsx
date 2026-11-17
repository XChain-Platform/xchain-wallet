// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G122 on Publish oracle price (operator 2026-11-15): the priced token is the
// standard Token field and token picker (owned tokens first, a search finds
// any token), the currency is the Fiat currency field and its picker page,
// and the PRICE payload carries exactly the picked TICK and FIAT codes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qoracleoracleoracleoracleoracleoraclex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

afterEach(cleanup);

function makeMessaging() {
    const calls = [];
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        oracleFeeds: vi.fn().mockResolvedValue([]),
        oracleConsumers: vi.fn().mockResolvedValue({ supported: true, dispensers: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'MYTOKEN' }]),
        searchTokens: vi.fn(({ query }) => Promise.resolve(
            'PEPECASH'.includes(query) ? [{ tick: 'PEPECASH' }] : [],
        )),
        composeForConfirm: vi.fn((args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 });
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        oraclePriceAction: vi.fn((args) => {
            calls.push({ method: 'oraclePriceAction', args });
            return Promise.resolve({ txid: 'tx-oracle' });
        }),
    };
    return { messaging, calls };
}

function mount(props = {}) {
    const { messaging, calls } = makeMessaging();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <OracleForm walletId="wallet-1" initialChainId={CHAIN} onBack={vi.fn()} {...props} />
        </MessagingProvider>,
    );
    return { messaging, calls };
}

describe('Publish oracle price Token field', () => {
    it('is the standard Token field, labelled Token, with no typed ticker box', async () => {
        mount({ initialTick: 'price' });
        expect(await screen.findByRole('button', { name: 'Token: PRICE on Bitcoin' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: /Token ticker/ })).toBeNull();
        expect(screen.queryByText('Token ticker')).toBeNull();
    });

    it('opens the token picker with owned tokens first and finds any token by search', async () => {
        const { messaging } = mount();
        fireEvent.click(await screen.findByRole('button', { name: /^Token: Select a token/ }));

        expect(await screen.findByRole('heading', { name: 'Select Token' })).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: /^Select MYTOKEN on Bitcoin\b/ })).toBeInTheDocument();
        expect(messaging.getOwnedTokens).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDRESS.address });

        fireEvent.click(screen.getByRole('button', { name: 'Filter coins and tokens' }));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search coins or tokens' }), { target: { value: 'PEPE' } });
        const found = await screen.findByRole('button', { name: /^Select PEPECASH on Bitcoin\b/ }, { timeout: 2000 });
        expect(messaging.searchTokens).toHaveBeenCalledWith({ chainId: CHAIN, query: 'PEPE', limit: 50 });

        fireEvent.click(found);
        expect(await screen.findByRole('button', { name: 'Token: PEPECASH on Bitcoin' })).toBeInTheDocument();
        expect(screen.getByLabelText(/^Price of one PEPECASH in USD/)).toBeInTheDocument();
    });

    it('searches from the first letter, since a ticker may be one character', async () => {
        const { messaging } = mount();
        fireEvent.click(await screen.findByRole('button', { name: /^Token: Select a token/ }));
        await screen.findByRole('button', { name: /^Select MYTOKEN on Bitcoin\b/ });
        fireEvent.click(screen.getByRole('button', { name: 'Filter coins and tokens' }));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search coins or tokens' }), { target: { value: 'P' } });
        await waitFor(() => expect(messaging.searchTokens).toHaveBeenCalledWith({ chainId: CHAIN, query: 'P', limit: 50 }), { timeout: 2000 });
        expect(await screen.findByRole('button', { name: /^Select PEPECASH on Bitcoin\b/ })).toBeInTheDocument();
    });
});

describe('Publish oracle price Fiat currency field', () => {
    it('is labelled Fiat currency, not a dropdown, and starts on USD', async () => {
        mount();
        const field = await screen.findByRole('button', { name: 'Fiat currency: USD, US Dollar' });
        expect(field).toBeInTheDocument();
        expect(screen.getByText('Fiat currency')).toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: /Currency/ })).toBeNull();
        expect(screen.queryByText(/^Currency$/)).toBeNull();
    });

    it('opens the picker page of the 12 protocol currencies and returns the pick', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: /^Fiat currency: USD/ }));
        const list = screen.getByRole('list', { name: 'Fiat currencies' });
        const rows = within(list).getAllByRole('button');
        expect(rows.map((row) => row.closest('li').getAttribute('data-fiat-currency-choice')))
            .toEqual(['USD', 'CAD', 'AUD', 'MXN', 'GBP', 'JPY', 'CNY', 'CHF', 'BRL', 'INR', 'EUR', 'KRW']);
        expect(rows[10]).toHaveTextContent('Shared currency of the euro area');
        fireEvent.click(rows[10]);
        expect(await screen.findByRole('button', { name: 'Fiat currency: EUR, Euro' })).toBeInTheDocument();
    });

    // The same picker page as Settings > Fiat Currency (walk 2026-11-15): one
    // rounded list card (the list class composes the shared flush card), and
    // the search only behind the title-bar filter button, never an inline field.
    it('draws the list in its own rounded card with the search behind the header filter button', async () => {
        const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/FiatCurrency.module.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        expect(/(^|[}\s])\.list\s*\{([^}]*)\}/.exec(css)?.[2] || '').toMatch(/composes:\s*flush from '\.\.\/\.\.\/ui\/Card\.module\.css'/);
        mount();
        fireEvent.click(await screen.findByRole('button', { name: /^Fiat currency: USD/ }));
        expect(screen.getByRole('list', { name: 'Fiat currencies' }).hasAttribute('data-fiat-currency-picker')).toBe(true);
        expect(screen.queryByRole('searchbox')).toBeNull();
        expect(screen.queryByPlaceholderText('Search by code or name')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Filter currencies' }));
        fireEvent.change(await screen.findByRole('searchbox', { name: 'Search currencies' }), { target: { value: 'yen' } });
        expect(within(screen.getByRole('list', { name: 'Fiat currencies' })).getAllByRole('button').map((row) => row.closest('li').getAttribute('data-fiat-currency-choice')))
            .toEqual(['JPY']);
    });
});

describe('Publish oracle price payload', () => {
    it('sends the picked TICK and FIAT exactly as the old fields did', async () => {
        const { calls } = mount();
        // Token through the picker.
        fireEvent.click(await screen.findByRole('button', { name: /^Token: Select a token/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select MYTOKEN on Bitcoin\b/ }));
        // Fiat currency through its picker.
        fireEvent.click(await screen.findByRole('button', { name: /^Fiat currency: USD/ }));
        fireEvent.click(within(screen.getByRole('list', { name: 'Fiat currencies' })).getByRole('button', { name: /JPY/ }));
        fireEvent.change(await screen.findByLabelText(/^Price of one MYTOKEN in JPY/), { target: { value: '12.5' } });

        fireEvent.click(screen.getByRole('button', { name: /^Publish price$/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

        await waitFor(() => expect(calls.some((call) => call.method === 'oraclePriceAction')).toBe(true));
        const publish = calls.find((call) => call.method === 'oraclePriceAction');
        expect(publish.args.params).toEqual({
            VERSION: '1', COIN: 'BTC', TICK: 'MYTOKEN', FIAT: 'JPY', VALUE: '12.5',
        });
    });
});
