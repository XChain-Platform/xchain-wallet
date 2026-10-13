// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '../../helpers/userEvent.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenPicker } from '../../../packages/core/src/shared/routes/TokenPicker.jsx';

const LONG_NAME = 'A token name long enough to wrap cleanly on a narrow wallet screen';
const balanceListCss = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components/BalanceList.module.css',
), 'utf8');
const balances = {
    'bitcoin-mainnet': [{
        address: 'bc1qpicker',
        balances: {
            native: { tick: 'BTC', quantity: '1000', divisibility: 8 },
            tokens: [
                { tick: 'WRP123', displayName: LONG_NAME, quantity: '3', divisibility: 0 },
                { tick: 'ZERO', displayName: 'Zero Bitcoin token', quantity: '0', divisibility: 0 },
            ],
        },
    }],
    'litecoin-mainnet': [{
        address: 'ltc1qpicker',
        balances: {
            native: { tick: 'LTC', quantity: '2000', divisibility: 8 },
            tokens: [
                { tick: 'LZERO', displayName: 'Zero Litecoin token', quantity: '0', divisibility: 0 },
            ],
        },
    }],
};

function makeMessaging(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({}),
        getWalletBalances: vi.fn().mockResolvedValue(balances),
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{ address: 'bc1qpicker' }],
            'litecoin-mainnet': [{ address: 'ltc1qpicker' }],
            'dogecoin-mainnet': [{ address: 'Dpicker' }],
        }),
        ...overrides,
    };
}

function mount({ purpose = 'send', messaging = makeMessaging(), ...props } = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenPicker
                purpose={purpose}
                walletId="wallet-1"
                onSelect={() => {}}
                onBack={() => {}}
                {...props}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('TokenPicker asset visibility and filtering', () => {
    it('hides known zero balances for Send but keeps them available for Receive', async () => {
        const { unmount } = mount({ purpose: 'send' });

        expect(await screen.findByText(LONG_NAME)).toBeInTheDocument();
        expect(screen.queryByText('Zero Bitcoin token')).toBeNull();
        expect(screen.queryByText('Zero Litecoin token')).toBeNull();

        unmount();
        mount({ purpose: 'receive' });

        expect(await screen.findByText('Zero Bitcoin token')).toBeInTheDocument();
        expect(screen.getByText('Zero Litecoin token')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Select Dogecoin\b/ })).toBeInTheDocument();
    });

    it('filters by display name and reports an empty search result', async () => {
        mount();
        const search = screen.getByRole('searchbox', { name: 'Search coins or tokens' });
        await screen.findByText(LONG_NAME);

        fireEvent.change(search, { target: { value: 'wrp123' } });
        expect(screen.getByRole('button', { name: /^Select Bitcoin\b/ })).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /^Select Bitcoin\b/ })).toBeNull();
        });
        expect(screen.getByText(LONG_NAME)).toBeInTheDocument();

        fireEvent.change(search, { target: { value: 'wrap cleanly' } });
        await waitFor(() => expect(screen.getByText(LONG_NAME)).toBeInTheDocument());

        fireEvent.change(search, { target: { value: 'missing asset' } });
        expect(await screen.findByText('No matching balances')).toBeInTheDocument();
        expect(screen.getByText('No balances match "missing asset".'))
            .toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Clear token search' }));
        expect(search).toHaveValue('');
        expect(screen.queryByRole('button', { name: 'Clear token search' })).toBeNull();
        expect(screen.getByRole('button', { name: /^Select Bitcoin\b/ })).toBeInTheDocument();
    });

    it('keeps long names on one line and ellipsizes them', () => {
        const nameRule = balanceListCss.match(/\.name\s*\{([^}]*)\}/)?.[1] || '';
        expect(nameRule).toMatch(/text-overflow:\s*ellipsis/);
        expect(nameRule).toMatch(/white-space:\s*nowrap/);
        expect(nameRule).toMatch(/min-width:\s*0/);
    });

    it('uses the chain filter for held balances and Receive platform discovery', async () => {
        const searchTokens = vi.fn(({ chainId }) => Promise.resolve([
            { tick: chainId.startsWith('litecoin') ? 'LTC.PEPE' : 'BTC.PEPE' },
        ]));
        mount({ purpose: 'receive', messaging: makeMessaging({ searchTokens }) });
        await screen.findByRole('button', { name: /^Select Bitcoin\b/ });

        fireEvent.click(screen.getByRole('button', { name: /All networks/ }));
        fireEvent.click(screen.getByRole('option', { name: /Litecoin/ }));

        expect(screen.getByRole('button', { name: /^Select Litecoin\b/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Select Bitcoin\b/ })).toBeNull();

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search coins or tokens' }), {
            target: { value: 'PEPE' },
        });
        await waitFor(() => expect(searchTokens).toHaveBeenCalledOnce());
        expect(searchTokens).toHaveBeenCalledWith({ chainId: 'litecoin-mainnet', query: 'PEPE', limit: 50 });
        expect(await screen.findByRole('button', { name: /^Select LTC.PEPE\b/ }))
            .toBeInTheDocument();
    });

    it('resets filters from an empty result', async () => {
        mount();
        const search = screen.getByRole('searchbox', { name: 'Search coins or tokens' });
        await screen.findByText(LONG_NAME);
        fireEvent.change(search, { target: { value: 'missing asset' } });

        fireEvent.click(await screen.findByRole('button', { name: 'Reset filters' }));
        expect(search).toHaveValue('');
        expect(await screen.findByText(LONG_NAME)).toBeInTheDocument();
    });

    it('retries balance and platform-search failures', async () => {
        const getWalletBalances = vi.fn()
            .mockRejectedValueOnce(new Error('balance service unavailable'))
            .mockResolvedValue(balances);
        const searchTokens = vi.fn()
            .mockRejectedValueOnce(new Error('search service unavailable'))
            .mockResolvedValueOnce([{ tick: 'LTC.PEPE' }]);
        mount({
            purpose: 'receive',
            messaging: makeMessaging({ getWalletBalances, searchTokens }),
        });

        expect(await screen.findByText('balance service unavailable')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await screen.findByRole('button', { name: /^Select Bitcoin\b/ });

        fireEvent.click(screen.getByRole('button', { name: /All networks/ }));
        fireEvent.click(screen.getByRole('option', { name: /Litecoin/ }));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search coins or tokens' }), {
            target: { value: 'PEPE' },
        });
        expect(await screen.findByText('Could not search all platform tokens. Try again.'))
            .toBeInTheDocument();
        expect(screen.queryByText('No matching balances')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByRole('button', { name: /^Select LTC.PEPE\b/ }))
            .toBeInTheDocument();
        expect(searchTokens).toHaveBeenCalledTimes(2);
    });
});

describe('TokenPicker keyboard and return behavior', () => {
    it('roves one token-row tab stop and closes with Escape', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        mount({ onBack });
        await screen.findByText(LONG_NAME);
        const rows = screen.getAllByRole('button', { name: /^Select / });

        expect(rows.map((row) => row.tabIndex)).toEqual([0, ...rows.slice(1).map(() => -1)]);
        rows[0].focus();
        fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
        expect(rows[1]).toHaveFocus();
        expect(rows.map((row) => row.tabIndex)).toEqual([-1, 0, ...rows.slice(2).map(() => -1)]);
        fireEvent.keyDown(rows[1], { key: 'Home' });
        expect(rows[0]).toHaveFocus();
        fireEvent.keyDown(rows[0], { key: 'End' });
        expect(rows.at(-1)).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('renders rows as keyboard-native buttons and returns the exact selection', async () => {
        const onSelect = vi.fn();
        const onBack = vi.fn();
        mount({ onSelect, onBack, backLabel: 'Back to send' });
        const row = await screen.findByRole('button', { name: new RegExp('^Select ' + LONG_NAME) });
        const search = screen.getByRole('searchbox', { name: 'Search coins or tokens' });

        fireEvent.change(search, { target: { value: 'wrp123' } });
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /^Select Bitcoin\b/ })).toBeNull();
        });
        search.focus();
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(row);
        search.focus();
        await act(async () => fireEvent.keyDown(search, { key: 'Enter' }));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-mainnet',
            tick: 'WRP123',
            kind: 'token',
            displayName: LONG_NAME,
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Back to send' }));
        expect(onBack).toHaveBeenCalledOnce();
    });
});
