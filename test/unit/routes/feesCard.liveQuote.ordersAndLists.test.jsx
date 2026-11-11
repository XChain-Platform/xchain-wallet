// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CallbackForm } from '../../../packages/core/src/shared/routes/CallbackForm.jsx';
import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { CrossChainOrderForm } from '../../../packages/core/src/shared/routes/CrossChainOrderForm.jsx';
import { SweepForm } from '../../../packages/core/src/shared/routes/SweepForm.jsx';
import { ListRenameForm } from '../../../packages/core/src/shared/routes/ListRenameForm.jsx';
import { ListShareForm } from '../../../packages/core/src/shared/routes/ListShareForm.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: () => ({
        formatNativeFee: () => '~$0.98',
        formatProtocolFee: () => '~$0.13',
        formatFeeTotal: () => '~$1.11',
    }),
}));

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listMetaSupported: vi.fn().mockResolvedValue(true),
    listFormatSupport: vi.fn().mockResolvedValue({ share: true, transfer: true, union: true }),
}));

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const SOURCE = Object.freeze({
    id: 'btc-source',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const DOGE_SOURCE = Object.freeze({
    id: 'doge-source',
    address: 'Ddevmock02aabbcc',
    publicKey: '02bb',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const DESTINATION = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const QUOTE = Object.freeze({ xchainFee: '0.064', requiredFeeSats: 197 });

const LIST_DETAIL = Object.freeze({
    action_index: 2700,
    type: 2,
    source: SOURCE.address,
    list_action_index: null,
    name: 'Old name',
    description: 'Old description',
    list: ['bc1qmember'],
    state: {
        owner: SOURCE.address,
        edit_resolution_active: true,
        current_list: ['bc1qmember'],
    },
});

const BET_FEED = Object.freeze({
    action_index: '2308',
    source: DESTINATION,
    label: 'Who wins?',
    outcomes: 'Home,Away',
    tick: 'XCHAIN',
    fee: '1',
    deadline: 1800000000,
    expire_at: 1801209600,
    feed_status: 'open',
    pools: [],
    timeline: [],
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.clearAllMocks();
});

function makeMessaging(overrides = {}, { quote = true } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BTC]: [SOURCE],
            [DOGE]: [DOGE_SOURCE],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [BTC]: { id: SOURCE.id },
            [DOGE]: { id: DOGE_SOURCE.id },
        }),
        getNewestAddress: vi.fn(async (_walletId, chainId) => (
            chainId === DOGE ? DOGE_SOURCE : SOURCE
        )),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', fiatCurrency: 'USD' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [BTC]: [{
                address: SOURCE.address,
                balances: {
                    native: { tick: 'BTC', quantity: '500000000', divisibility: 8 },
                    tokens: [
                        { tick: 'XCHAIN', quantity: '100000', divisibility: 2 },
                        { tick: 'PAY', quantity: '100000', divisibility: 2 },
                    ],
                },
            }],
        }),
        getTokenInfo: vi.fn(async ({ tick }) => {
            if (tick === 'CALLABLE') {
                return {
                    tick: 'CALLABLE',
                    creator: SOURCE.address,
                    callbackTick: 'PAY',
                    callbackAmount: '1.25',
                    callbackBlock: '100',
                };
            }
            return { tick, divisibility: 2 };
        }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 120 }),
        tokenHolderSummary: vi.fn().mockResolvedValue({
            recipientCount: 1,
            totalPayout: '2.5',
            partial: false,
        }),
        sweepPreview: vi.fn().mockResolvedValue({}),
        getListByActionIndex: vi.fn().mockResolvedValue(LIST_DETAIL),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
        betFeed: vi.fn().mockResolvedValue({ data: [BET_FEED] }),
        betProjectPayout: vi.fn().mockResolvedValue(null),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ORDER|0', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        ...(quote ? { quoteProtocolFee: vi.fn().mockResolvedValue(QUOTE) } : {}),
        ...overrides,
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (property === 'quoteProtocolFee') return undefined;
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            object[property] = stub;
            return stub;
        },
    });
}

function mount(element, messaging) {
    render(
        <MessagingProvider shell="desktop" messaging={messaging}>
            {element}
        </MessagingProvider>,
    );
}

async function expectLiveQuote(messaging, actionData, chainId = BTC, source = SOURCE.address) {
    await waitFor(() => expect(messaging.quoteProtocolFee).toHaveBeenCalledWith({
        chainId,
        source,
        actionData,
    }), { timeout: 2500 });
    expect(await screen.findByText('0.064 XCHAIN')).toBeInTheDocument();
    expect(screen.getByText(/\+ 0\.064 XCHAIN/)).toBeInTheDocument();
}

describe('Fees card live quotes for orders and lists', () => {
    it('quotes CallbackForm with the same CALLBACK params used for review', async () => {
        const messaging = makeMessaging();
        mount(
            <CallbackForm
                walletId="wallet-1"
                onBack={() => {}}
                initialChainId={BTC}
                initialTick="CALLABLE"
                initialFromAddress={SOURCE.address}
            />,
            messaging,
        );

        await expectLiveQuote(messaging, {
            action: 'CALLBACK',
            params: { VERSION: '0', TICK: 'CALLABLE' },
        });
    });

    it('quotes CreateOrderForm after both order legs are valid', async () => {
        const messaging = makeMessaging();
        mount(
            <CreateOrderForm
                walletId="wallet-1"
                onBack={() => {}}
                initialChainId={BTC}
                initialFromAddress={SOURCE.address}
            />,
            messaging,
        );

        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'XCHAIN' } });
        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Amount (BTC)'), { target: { value: '2' } });

        await expectLiveQuote(messaging, {
            action: 'ORDER',
            params: {
                VERSION: '0', GIVE_COIN: 'BTC', GET_COIN: 'BTC',
                GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '1', GET_TICK: '', GET_AMOUNT: '2',
            },
        });
    });

    it('quotes CrossChainOrderForm on the give chain', async () => {
        const messaging = makeMessaging();
        mount(
            <CrossChainOrderForm
                walletId="wallet-1"
                onBack={() => {}}
                initialChainId={BTC}
                initialFromAddress={SOURCE.address}
            />,
            messaging,
        );

        fireEvent.click(await screen.findByRole('button', { name: /^Give token:/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select XCHAIN(?: on |$)/ }));
        fireEvent.change(screen.getByLabelText(/^Give amount/), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Get token'), { target: { value: 'DOGECOIN' } });
        fireEvent.change(screen.getByLabelText(/^Get amount/), { target: { value: '2' } });

        await expectLiveQuote(messaging, {
            action: 'ORDER',
            params: {
                VERSION: '0', GIVE_COIN: 'BTC', GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '1',
                GET_COIN: 'DOGE', GET_TICK: 'DOGECOIN', GET_AMOUNT: '2',
                GET_ADDRESS: DOGE_SOURCE.address,
            },
        });
    });

    it('gates SweepForm until the destination is valid, then quotes SWEEP', async () => {
        const messaging = makeMessaging();
        mount(
            <SweepForm
                walletId="wallet-1"
                onBack={() => {}}
                initialChainId={BTC}
                initialFromAddress={SOURCE.address}
            />,
            messaging,
        );

        const destination = await screen.findByLabelText('Destination address');
        expect(messaging.quoteProtocolFee).not.toHaveBeenCalled();
        fireEvent.change(destination, { target: { value: DESTINATION } });

        await expectLiveQuote(messaging, {
            action: 'SWEEP',
            params: {
                VERSION: '0', DESTINATION,
                BALANCES: '1', OWNERSHIPS: '1', ORDERS: '0', SWAPS: '0', DISPENSERS: '0',
            },
        });
    });

    it('quotes a shared ListRenameForm with its extracted format 5 params', async () => {
        const messaging = makeMessaging({
            getSharedLists: vi.fn().mockResolvedValue({
                lists: [{ kind: 'home', home_chain: 'BTC', home_list_index: 2700 }],
            }),
        });
        mount(
            <ListRenameForm
                walletId="wallet-1"
                listRef={{ chainId: BTC, actionIndex: '2700' }}
                onBack={() => {}}
            />,
            messaging,
        );

        fireEvent.change(await screen.findByLabelText('Name'), {
            target: { value: ' Treasury ' },
        });

        await expectLiveQuote(messaging, {
            action: 'LIST',
            params: {
                VERSION: '5', LIST_ACTION_INDEX: '2700',
                NAME: 'Treasury', DESCRIPTION: '', MEMO: '',
            },
        });
    });

    it('quotes ListShareForm with its extracted format 2 params', async () => {
        const messaging = makeMessaging();
        mount(
            <ListShareForm
                walletId="wallet-1"
                listRef={{ chainId: BTC, actionIndex: '2700' }}
                onBack={() => {}}
            />,
            messaging,
        );

        await screen.findByLabelText('Type SHARE to confirm');
        await expectLiveQuote(messaging, {
            action: 'LIST',
            params: { VERSION: '2', LIST_ACTION_INDEX: '2700', MEMO: '' },
        });
    });

    it('quotes BetFeedDetail with the BET v2 params produced by the host builder', async () => {
        const messaging = makeMessaging();
        mount(
            <BetFeedDetail
                walletId="wallet-1"
                chainId={BTC}
                feedIndex="2308"
                onBack={() => {}}
            />,
            messaging,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Home' }));
        fireEvent.change(screen.getByLabelText('Stake (XCHAIN)'), { target: { value: '5' } });

        await expectLiveQuote(messaging, {
            action: 'BET',
            params: {
                version: 2, feedActionIndex: '2308', outcome: '0', amount: '5', memo: '',
            },
        });
    });

    it('quotes PlaceOrderPanel and review composes the exact quoted action data', async () => {
        const messaging = makeMessaging();
        mount(
            <PlaceOrderPanel
                walletId="wallet-1"
                chainId={BTC}
                tick1="XCHAIN"
                tick2="BTC"
            />,
            messaging,
        );

        fireEvent.change(await screen.findByLabelText('Price (BTC)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '2' } });

        await waitFor(() => expect(messaging.quoteProtocolFee).toHaveBeenCalled(), { timeout: 2500 });
        const quotedActionData = messaging.quoteProtocolFee.mock.calls.at(-1)[0].actionData;
        expect(quotedActionData).toMatchObject({
            action: 'ORDER',
            params: {
                VERSION: '0', GIVE_COIN: 'BTC', GET_COIN: 'BTC',
                GIVE_TICK: '', GIVE_AMOUNT: '4', GET_TICK: 'XCHAIN', GET_AMOUNT: '2',
            },
        });
        expect(await screen.findByText('0.064 XCHAIN')).toBeInTheDocument();
        expect(screen.getByText(/\+ 0\.064 XCHAIN/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Place buy order' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData).toEqual(quotedActionData);
    });

    it('falls back to review pricing when the shell has no quote transport', async () => {
        const messaging = makeMessaging({}, { quote: false });
        mount(
            <SweepForm
                walletId="wallet-1"
                onBack={() => {}}
                initialChainId={BTC}
                initialFromAddress={SOURCE.address}
                initialDestination={DESTINATION}
            />,
            messaging,
        );

        expect((await screen.findAllByText('Priced at review')).length).toBeGreaterThanOrEqual(2);
    });
});
