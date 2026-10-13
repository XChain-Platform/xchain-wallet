// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';
import { DispenserExplorer } from '../../../packages/core/src/shared/routes/DispenserExplorer.jsx';
import { dispenserFillPriceLabel } from '../../../packages/core/src/shared/utils/dispenserPricing.js';

const BTC_CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'source', address: 'bc1qsourcesourcesourcesourcesourcesources', publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
};
const BUYER = {
    id: 'buyer', address: 'bc1qbuyerbuyerbuyerbuyerbuyerbuyerbuyerbu', publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/1", source: 'hd', signerId: 'signer-1',
};
const OWNER = 'bc1qownerownerownerownerownerownerownerow';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function provider(children, messaging) {
    return <MessagingProvider shell="web" messaging={messaging}>{children}</MessagingProvider>;
}

function commonMessaging(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet', walletMode: 'full', privacy: { priceDataEnabled: false } }),
        updateSettings: vi.fn().mockImplementation(async (value) => value),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getDispenserLifecycle: vi.fn().mockResolvedValue({ data: [] }),
        getDispensersForAddress: vi.fn().mockResolvedValue({ data: [] }),
        reserve: vi.fn().mockResolvedValue(null),
        releaseReservation: vi.fn().mockResolvedValue(null),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('dispenser async safety', () => {
    it('derives only one address when Create is submitted twice in the same render', async () => {
        const generated = deferred();
        const messaging = commonMessaging({
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC_CHAIN]: [SOURCE] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC_CHAIN]: SOURCE }),
            generateDispenserAddress: vi.fn(() => generated.promise),
            composeForConfirm: vi.fn(),
        });
        render(provider(
            <DispenserForm walletId="wallet-a" initialChainId={BTC_CHAIN} initialTick="XCHAIN" onBack={() => {}} />,
            messaging,
        ));

        fireEvent.change(await screen.findByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
        const create = await screen.findByRole('button', { name: 'Create' });
        await waitFor(() => expect(create).toBeEnabled());

        const form = create.closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);
        expect(messaging.generateDispenserAddress).toHaveBeenCalledTimes(1);

        await act(async () => generated.resolve({
            id: 'dispenser', address: 'bc1qderivedderivedderivedderivedderivedde', source: 'hd',
        }));
    });

    it('does not compose a derived address after the wallet changes', async () => {
        const generated = deferred();
        const messaging = commonMessaging({
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC_CHAIN]: [SOURCE] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC_CHAIN]: SOURCE }),
            generateDispenserAddress: vi.fn(() => generated.promise),
            composeForConfirm: vi.fn(),
        });
        const form = (walletId) => provider(
            <DispenserForm walletId={walletId} initialChainId={BTC_CHAIN} initialTick="XCHAIN" onBack={() => {}} />,
            messaging,
        );
        const view = render(form('wallet-a'));
        fireEvent.change(await screen.findByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
        const create = await screen.findByRole('button', { name: 'Create' });
        await waitFor(() => expect(create).toBeEnabled());
        fireEvent.click(create);
        await waitFor(() => expect(messaging.generateDispenserAddress).toHaveBeenCalledOnce());

        view.rerender(form('wallet-b'));
        await act(async () => generated.resolve({
            id: 'dispenser', address: 'bc1qderivedderivedderivedderivedderivedde', source: 'hd',
        }));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('persists token payment terms when only those draft fields change', async () => {
        const messaging = commonMessaging({
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC_CHAIN]: [SOURCE] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC_CHAIN]: SOURCE }),
        });
        const mount = () => render(provider(
            <DispenserForm walletId="wallet-draft" initialChainId={BTC_CHAIN} initialTick="XCHAIN" onBack={() => {}} />,
            messaging,
        ));
        const first = mount();
        fireEvent.click(await screen.findByLabelText('A token'));
        fireEvent.change(screen.getByLabelText('Payment token'), { target: { value: 'PAY' } });
        fireEvent.change(screen.getByLabelText('Payment amount (per fill)'), { target: { value: '4.5' } });

        const key = 'xc:formdraft:dispenser:wallet-draft';
        await waitFor(() => expect(JSON.parse(localStorage.getItem(key)).values).toMatchObject({
            payWith: 'token', getTick: 'PAY', getTokenAmount: '4.5',
        }));
        first.unmount();
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));

        await waitFor(() => expect(screen.getByLabelText('A token')).toBeChecked());
        expect(screen.getByLabelText('Payment token')).toHaveValue('PAY');
        expect(screen.getByLabelText('Payment amount (per fill)')).toHaveValue('4.5');
    });

    it('runs one identical explorer search while its request is pending', async () => {
        const response = deferred();
        const getDispensersForToken = vi.fn(() => response.promise);
        const messaging = commonMessaging({
            getDispensersForToken,
            getDispensersForAddress: vi.fn(),
        });
        render(provider(<DispenserExplorer onOpenDispenser={() => {}} onBack={() => {}} />, messaging));

        const chain = await screen.findByRole('combobox');
        await waitFor(() => expect(chain.options.length).toBeGreaterThan(1));
        fireEvent.change(chain, { target: { value: chain.options[1].value } });
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'XCHAIN' } });
        const form = screen.getByRole('textbox').closest('form');
        await waitFor(() => expect(screen.getByRole('button', { name: /search/i })).toBeEnabled());
        fireEvent.submit(form);
        fireEvent.submit(form);

        await waitFor(() => expect(getDispensersForToken).toHaveBeenCalledTimes(1));
        await act(async () => response.resolve({ data: [] }));
    });

    it('invalidates an explorer search when its selected chain leaves the active network', async () => {
        const response = deferred();
        const messaging = commonMessaging({
            getDispensersForToken: vi.fn(() => response.promise),
            getDispensersForAddress: vi.fn(),
        });
        render(provider(<DispenserExplorer onOpenDispenser={() => {}} onBack={() => {}} />, messaging));

        const chain = await screen.findByRole('combobox');
        await waitFor(() => expect(chain.options.length).toBeGreaterThan(1));
        fireEvent.change(chain, { target: { value: chain.options[1].value } });
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'XCHAIN' } });
        fireEvent.submit(screen.getByRole('textbox').closest('form'));
        await waitFor(() => expect(messaging.getDispensersForToken).toHaveBeenCalledOnce());

        await act(async () => window.dispatchEvent(new CustomEvent('xc:settings-changed', {
            detail: { activeNetwork: 'regtest', walletMode: 'full' },
        })));
        await waitFor(() => expect(chain).toHaveValue('all'));
        expect(screen.queryByText(/Searching dispensers/)).toBeNull();

        await act(async () => response.resolve({
            data: [{ action_index: 'old', give_tick: 'XCHAIN', source: OWNER, current_status: 'open' }],
        }));
        expect(screen.queryByText(/#old/)).toBeNull();
    });

    it('matches an explorer oracle quote by coin, token, and fiat', () => {
        const row = {
            get_coin: 'BTC', get_tick: null, get_amount: '0', give_tick: 'XCHAIN', give_amount: '2',
            fiat: 'USD', fiat_amount: null, oracle_address: 'oracle',
        };
        const wrongCoin = { coin: 'LTC', tick: 'XCHAIN', fiat: 'USD', live: { value: '99' } };
        const rightFeed = { coin: 'BTC', tick: 'XCHAIN', fiat: 'USD', live: { value: '3' } };

        expect(dispenserFillPriceLabel(row, [wrongCoin, rightFeed])).toContain('6 USD');
        expect(dispenserFillPriceLabel(row, [wrongCoin])).not.toContain('99');
    });

    it('clears the prior dispenser oracle quote while the next quote loads', async () => {
        const nextQuote = deferred();
        const rows = {
            one: {
                action_index: 'one', source: OWNER, address: OWNER, give_tick: 'XCHAIN', give_amount: '5',
                get_coin: 'BTC', get_tick: null, get_amount: '0', fiat: 'USD', fiat_amount: null,
                oracle_address: 'oracle-one', escrow_remaining: '100', current_status: 'open', status: 'open',
            },
            two: {
                action_index: 'two', source: OWNER, address: OWNER, give_tick: 'XCHAIN', give_amount: '5',
                get_coin: 'BTC', get_tick: null, get_amount: '0', fiat: 'USD', fiat_amount: null,
                oracle_address: 'oracle-two', escrow_remaining: '100', current_status: 'open', status: 'open',
            },
        };
        const messaging = commonMessaging({
            getDispenserByActionIndex: vi.fn(({ actionIndex }) => Promise.resolve(rows[actionIndex])),
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC_CHAIN]: [BUYER] }),
            oracleFeeds: vi.fn(({ address }) => address === 'oracle-one'
                ? Promise.resolve([{ coin: 'BTC', tick: 'XCHAIN', fiat: 'USD', live: { value: '2' } }])
                : nextQuote.promise),
        });
        const view = render(provider(
            <DispenserDetail walletId="wallet-a" chainId={BTC_CHAIN} actionIndex="one" onBack={() => {}} />,
            messaging,
        ));
        expect(await screen.findAllByText(/10 USD/)).not.toHaveLength(0);

        view.rerender(provider(
            <DispenserDetail walletId="wallet-a" chainId={BTC_CHAIN} actionIndex="two" onBack={() => {}} />,
            messaging,
        ));
        await waitFor(() => expect(messaging.oracleFeeds).toHaveBeenCalledWith({
            chainId: BTC_CHAIN, address: 'oracle-two',
        }));
        await waitFor(() => expect(screen.queryAllByText(/10 USD/)).toHaveLength(0));
        expect(screen.getAllByText(/Set by an oracle, in USD/)).not.toHaveLength(0);
    });

    it('starts one watcher owner action for two same-render submits', async () => {
        const build = deferred();
        const dispenser = {
            action_index: '7', source: SOURCE.address, address: SOURCE.address,
            give_tick: 'XCHAIN', give_amount: '5', get_coin: 'BTC', get_amount: '0.001',
            escrow_remaining: '100', current_status: 'open', status: 'open',
        };
        const messaging = commonMessaging({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet', walletMode: 'watcher' }),
            getDispenserByActionIndex: vi.fn().mockResolvedValue(dispenser),
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC_CHAIN]: [SOURCE] }),
            buildActionPsbtRequest: vi.fn(() => build.promise),
        });
        render(provider(
            <DispenserDetail walletId="wallet-a" chainId={BTC_CHAIN} actionIndex="7" onBack={() => {}} />,
            messaging,
        ));

        fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
        const submit = await screen.findByRole('button', { name: 'Create unsigned transaction' });
        const form = submit.closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);
        expect(messaging.buildActionPsbtRequest).toHaveBeenCalledTimes(1);

        await act(async () => build.resolve({ psbtHex: '00', fromAddress: SOURCE.address }));
    });

    it('starts one watcher create for two same-render submits', async () => {
        const build = deferred();
        const messaging = commonMessaging({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet', walletMode: 'watcher' }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC_CHAIN]: [SOURCE] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC_CHAIN]: SOURCE }),
            generateDispenserAddress: vi.fn().mockResolvedValue({
                id: 'dispenser', address: 'bc1qderivedderivedderivedderivedderivedde', source: 'hd',
            }),
            buildActionPsbtRequest: vi.fn(() => build.promise),
        });
        render(provider(
            <DispenserForm walletId="wallet-a" initialChainId={BTC_CHAIN} initialTick="XCHAIN" onBack={() => {}} />,
            messaging,
        ));
        fireEvent.change(await screen.findByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Create' }));

        const submit = await screen.findByRole('button', { name: 'Create unsigned transaction' });
        const form = submit.closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);
        expect(messaging.buildActionPsbtRequest).toHaveBeenCalledOnce();

        await act(async () => build.resolve({ psbtHex: '00', fromAddress: SOURCE.address }));
    });

    it('starts one watcher buy while access-list refresh is pending', async () => {
        const tokenInfo = deferred();
        const dispenser = {
            action_index: '8', source: OWNER, address: OWNER,
            give_tick: 'XCHAIN', give_amount: '5', get_coin: 'BTC', get_amount: '0.001',
            escrow_remaining: '100', current_status: 'open', status: 'open',
        };
        let tokenReads = 0;
        const messaging = commonMessaging({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet', walletMode: 'watcher' }),
            getDispenserByActionIndex: vi.fn().mockResolvedValue(dispenser),
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC_CHAIN]: [BUYER] }),
            getWalletBalances: vi.fn().mockResolvedValue({
                [BTC_CHAIN]: [{
                    address: BUYER.address,
                    balances: { native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] },
                }],
            }),
            getTokenInfo: vi.fn(() => {
                tokenReads += 1;
                return tokenReads === 1 ? Promise.resolve(null) : tokenInfo.promise;
            }),
            buildSendPsbtRequest: vi.fn(),
        });
        render(provider(
            <DispenserDetail walletId="wallet-a" chainId={BTC_CHAIN} actionIndex="8" onBack={() => {}} />,
            messaging,
        ));

        const buy = await screen.findByRole('button', { name: 'Create unsigned transaction' });
        await waitFor(() => expect(buy).toBeEnabled());
        fireEvent.click(buy);
        fireEvent.click(buy);
        await waitFor(() => expect(messaging.getTokenInfo).toHaveBeenCalledTimes(2));
        expect(messaging.buildSendPsbtRequest).not.toHaveBeenCalled();

        await act(async () => tokenInfo.resolve(null));
        await waitFor(() => expect(messaging.buildSendPsbtRequest).toHaveBeenCalledOnce());
    });
});
