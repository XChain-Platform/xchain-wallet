// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: () => ({
        formatNativeFee: () => '~$0.98',
        formatProtocolFee: () => '~$0.13',
        formatFeeTotal: () => '~$1.11',
    }),
}));

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const RECIPIENT = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const ADDRESS = {
    id: 'address-1',
    address: SOURCE,
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
    chainId: CHAIN,
};
const QUOTE = { xchainFee: '0.064', requiredFeeSats: 197 };

afterEach(cleanup);

function makeMessaging(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', fiatCurrency: 'USD' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getTokenInfo: vi.fn(async ({ tick }) => (
            String(tick).toUpperCase() === 'OWNED'
                ? { tick, creator: SOURCE, divisibility: 0, maxSupply: '1' }
                : null
        )),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: { tokens: [{ tick: 'DROP', quantity: '10000000000', divisibility: 8 }] },
            }],
        }),
        listContacts: vi.fn().mockResolvedValue([]),
        quoteProtocolFee: vi.fn().mockResolvedValue(QUOTE),
        generateDispenserAddress: undefined,
        ...overrides,
    };
    return new Proxy(target, {
        get(current, prop) {
            if (prop in current) return current[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            current[prop] = stub;
            return stub;
        },
    });
}

function mount(node, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {node}
        </MessagingProvider>,
    );
}

async function expectLiveQuote(messaging, actionData) {
    await waitFor(() => expect(messaging.quoteProtocolFee).toHaveBeenCalledWith({
        chainId: CHAIN,
        source: SOURCE,
        actionData,
    }), { timeout: 3000 });
    expect(await screen.findByText('0.064 XCHAIN')).toBeInTheDocument();
    expect(screen.getByText(/\+ 0\.064 XCHAIN/)).toBeInTheDocument();
}

describe('live fee quotes for issue and dispenser forms', () => {
    it('quotes the LIST leg of an airdrop and waits for valid recipients', async () => {
        const messaging = makeMessaging();
        mount(
            <AirdropForm walletId="wallet-1" initialChainId={CHAIN} initialTick="DROP" onBack={() => {}} />,
            messaging,
        );

        await screen.findByLabelText('Recipients');
        await new Promise((resolve) => setTimeout(resolve, 450));
        expect(messaging.quoteProtocolFee).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Recipients'), { target: { value: RECIPIENT } });

        await expectLiveQuote(messaging, {
            action: 'LIST',
            params: { VERSION: '0', TYPE: '2', ITEM: [RECIPIENT] },
        });
    });

    it('quotes a dispenser create with the params used by review', async () => {
        const messaging = makeMessaging();
        mount(
            <DispenserForm
                walletId="wallet-1"
                activeAccountId="account-1"
                initialChainId={CHAIN}
                initialTick="DROP"
                onBack={() => {}}
            />,
            messaging,
        );

        fireEvent.change(await screen.findByRole('textbox', { name: /Give amount per fill/ }), { target: { value: '1' } });
        fireEvent.change(screen.getByRole('textbox', { name: /Escrow amount/ }), { target: { value: '10' } });
        fireEvent.change(screen.getByRole('textbox', { name: /Trigger price/ }), { target: { value: '1' } });

        await expectLiveQuote(messaging, {
            action: 'DISPENSER',
            params: {
                VERSION: '0',
                GIVE_TICK: 'DROP',
                GIVE_COIN: 'BTC',
                GIVE_AMOUNT: '1',
                GIVE_ESCROW: '10',
                GET_COIN: 'BTC',
                GET_AMOUNT: '1',
            },
        });
    });

    it('quotes the dispenser owner action shown by its Fees card', async () => {
        const dispenser = {
            action_index: '2868', source: SOURCE, address: SOURCE,
            give_tick: 'DROP', give_amount: '1', get_coin: 'BTC', get_amount: '1',
            escrow_remaining: '10', status: 'open', current_status: 'open',
        };
        const messaging = makeMessaging({
            getDispenserByActionIndex: vi.fn().mockResolvedValue(dispenser),
            getDispenses: vi.fn().mockResolvedValue({ data: [] }),
            getDispenserLifecycle: vi.fn().mockResolvedValue({ data: [] }),
        });
        mount(
            <DispenserDetail
                walletId="wallet-1"
                chainId={CHAIN}
                actionIndex="2868"
                onBack={() => {}}
                onCanceled={() => {}}
            />,
            messaging,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
        await expectLiveQuote(messaging, {
            action: 'DISPENSER',
            params: { VERSION: '1', DISPENSER_ACTION_INDEX: '2868' },
        });
    });

    it('quotes a new ISSUE with the exact form params', async () => {
        const messaging = makeMessaging();
        mount(<IssueTokenForm walletId="wallet-1" onBack={() => {}} />, messaging);

        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'NEW' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '100' } });

        await expectLiveQuote(messaging, {
            action: 'ISSUE',
            params: {
                VERSION: '0', TICK: 'NEW', DECIMALS: '8',
                MAX_SUPPLY: '100', MINT_SUPPLY: '100',
            },
        });
    });

    it('quotes a ticker reservation, which is a new ISSUE too', async () => {
        const messaging = makeMessaging();
        mount(<IssueTokenForm walletId="wallet-1" onBack={() => {}} />, messaging);

        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'NEW' } });

        await expectLiveQuote(messaging, {
            action: 'ISSUE',
            params: { VERSION: '0', TICK: 'NEW', DECIMALS: '8' },
        });
    });

    it('stops quoting while an Issue input would be refused at review', async () => {
        const messaging = makeMessaging();
        mount(<IssueTokenForm walletId="wallet-1" onBack={() => {}} />, messaging);

        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'NEW' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '100' } });
        await waitFor(() => expect(messaging.quoteProtocolFee).toHaveBeenCalled(), { timeout: 3000 });
        messaging.quoteProtocolFee.mockClear();

        // Stop block before start block is refused at review, so it is not priced.
        fireEvent.change(screen.getByLabelText(/^Start block/), { target: { value: '200' } });
        fireEvent.change(screen.getByLabelText(/^Stop block/), { target: { value: '100' } });
        await new Promise((resolve) => { setTimeout(resolve, 600); });
        expect(messaging.quoteProtocolFee).not.toHaveBeenCalled();
    });

    it('quotes the Token Wizard ISSUE payload', async () => {
        const messaging = makeMessaging();
        mount(<TokenWizard walletId="wallet-1" onBack={() => {}} />, messaging);

        fireEvent.click(await screen.findByRole('button', { name: /Meme token/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
        fireEvent.change(await screen.findByLabelText('Token name (ticker)'), { target: { value: 'MEME' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });

        await expectLiveQuote(messaging, {
            action: 'ISSUE',
            params: {
                VERSION: '0', TICK: 'MEME', DECIMALS: '0',
                MAX_SUPPLY: '1000', MINT_SUPPLY: '1000',
                LOCK_MAX_SUPPLY: '1', LOCK_MINT: '1', LOCK_MINT_SUPPLY: '1',
            },
        });
    });

    it('quotes the selected ownership sale action', async () => {
        const messaging = makeMessaging();
        mount(
            <SellOwnershipForm walletId="wallet-1" chainId={CHAIN} tick="OWNED" onBack={() => {}} />,
            messaging,
        );

        fireEvent.click(await screen.findByRole('tab', { name: 'Instant buy' }));
        fireEvent.change(screen.getByLabelText(/^Price/), { target: { value: '5' } });

        await expectLiveQuote(messaging, {
            action: 'DISPENSER',
            params: {
                VERSION: '0', GIVE_COIN: 'BTC', GIVE_TICK: 'OWNED',
                GIVE_OWNERSHIP: '1', GET_COIN: 'BTC', GET_AMOUNT: '5',
            },
        });
    });

    it('keeps review pricing when the quote transport is unavailable', async () => {
        const messaging = makeMessaging({ quoteProtocolFee: undefined });
        mount(<IssueTokenForm walletId="wallet-1" onBack={() => {}} />, messaging);

        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'NEW' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '100' } });

        await waitFor(() => expect(screen.getAllByText('Priced at review')).toHaveLength(2));
    });
});
