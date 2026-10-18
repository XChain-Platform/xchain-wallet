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
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import React from 'react';

const emptyStateTitles = vi.hoisted(() => []);

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    const { createElement } = await import('react');
    return {
        ...actual,
        EmptyState: (props) => {
            emptyStateTitles.push(props.title);
            return createElement(actual.EmptyState, props);
        },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { SendPicker } from '../../../packages/core/src/shared/routes/SendPicker.jsx';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const BTC_FROM = 'bc1qsendersendersendersendersendersendersa';
const DOGE_FROM = 'DHy1Qk7Zx8dCn4eW1sT9pVb2xKq3rLm5Ns';
const EMPTY_TITLE = 'This wallet has no coins to send yet.';

const balance = (tick, quantity) => ({
    native: { tick, quantity, divisibility: 8 },
    tokens: [],
});

function ChainPickerHarness({ messaging }) {
    const [prefill, setPrefill] = React.useState({ chainId: BTC, tick: 'BTC' });
    const [pickerOpen, setPickerOpen] = React.useState(false);
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <Send
                walletId="w"
                prefill={prefill}
                onBack={() => {}}
                onChangeAsset={() => setPickerOpen(true)}
            />
            {pickerOpen ? (
                <SendPicker
                    walletId="w"
                    onBack={() => setPickerOpen(false)}
                    onSelect={(selection) => {
                        setPrefill({ chainId: selection.chainId, tick: selection.tick });
                        setPickerOpen(false);
                    }}
                />
            ) : null}
        </MessagingProvider>
    );
}

function mount() {
    let finishDogeAddressRead = () => {};
    const btcBalance = balance('BTC', '100000000');
    const dogeBalance = balance('DOGE', '200000000');
    const addresses = {
        [BTC]: [{ id: 'btc-1', address: BTC_FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        [DOGE]: [{ id: 'doge-1', address: DOGE_FROM, publicKey: '02cd', derivationPath: "m/44'/3'/0'/0/0", source: 'hd' }],
    };
    const getWalletBalances = vi.fn()
        .mockResolvedValueOnce({
            [BTC]: [{ address: BTC_FROM, balances: btcBalance, error: null }],
        })
        .mockResolvedValueOnce({
            [BTC]: [{ address: BTC_FROM, balances: btcBalance, error: null }],
            [DOGE]: [{ address: DOGE_FROM, balances: dogeBalance, error: null }],
        })
        .mockImplementation(() => new Promise(() => {}));
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [BTC]: { id: 'btc-1', address: BTC_FROM },
            [DOGE]: { id: 'doge-1', address: DOGE_FROM },
        }),
        getAddressBalances: vi.fn((chainId) => (
            chainId === BTC
                ? Promise.resolve(btcBalance)
                : new Promise((resolve) => { finishDogeAddressRead = () => resolve(dogeBalance); })
        )),
        getWalletBalances,
        getSettings: vi.fn().mockResolvedValue({
            walletMode: 'full',
            activeNetwork: 'mainnet',
            grace: { testSendThresholdSats: 0 },
        }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });

    render(<ChainPickerHarness messaging={messaging} />);
    return { messaging, finishDogeAddressRead: () => finishDogeAddressRead() };
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('Send balance gate during a chain switch', () => {
    it('keeps the form mounted and never flashes the empty state while the next balance read hangs', async () => {
        const { messaging, finishDogeAddressRead } = mount();
        const form = await screen.findByRole('form', { name: 'Send' });
        await screen.findByText('1 BTC available');
        emptyStateTitles.length = 0;

        fireEvent.click(screen.getByRole('button', { name: /Change asset/ }));
        expect(screen.getByRole('form', { name: 'Send' })).toBe(form);
        fireEvent.click(await screen.findByRole('button', { name: /^Select Dogecoin\b/ }));

        expect(screen.getByRole('form', { name: 'Send' })).toBe(form);
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(3));
        expect(messaging.getAddressBalances).toHaveBeenCalledWith(DOGE, DOGE_FROM);
        expect(screen.getByRole('form', { name: 'Send' })).toBe(form);
        expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
        expect(emptyStateTitles).not.toContain(EMPTY_TITLE);
        expect(await screen.findByText('Balance unavailable')).toBeInTheDocument();

        await act(async () => { finishDogeAddressRead(); });
        await waitFor(() => expect(screen.getByText('2 DOGE available')).toBeInTheDocument());
        expect(screen.queryByText('Balance unavailable')).toBeNull();
        expect(screen.getByRole('form', { name: 'Send' })).toBe(form);
        expect(emptyStateTitles).not.toContain(EMPTY_TITLE);
    });
});
