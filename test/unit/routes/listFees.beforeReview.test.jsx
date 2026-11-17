// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every list form knows its protocol fee before review (listFeeSchedule.js):
// the Share page prices its one flat fee from the chain's fee schedule and
// shows it in XCHAIN with its fiat value, Create and a fork copy are free, an
// edit of a shared list pays the shared-edit fee. The pay-in-coin switch
// stays where every form has it. The schedule is read once per chain.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { ownerRun, fiat } = vi.hoisted(() => ({
    ownerRun: vi.fn(),
    fiat: { priced: true },
}));

vi.mock('../../../packages/core/src/shared/hooks/useOwnerActionLane.js', () => ({
    useOwnerActionLane: () => ({
        open: false,
        composing: false,
        confirmProps: {},
        run: ownerRun,
    }),
}));

// XCHAIN at $0.25, so the 1 XCHAIN share fee reads ~$0.25; `fiat.priced`
// false is a network with no price at all.
vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: () => ({
        formatProtocolFee: (amount) => (fiat.priced ? `~$${(Number(amount) * 0.25).toFixed(2)}` : null),
        formatNativeFee: () => null,
        formatFeeTotal: () => null,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { __clearFeeScheduleCache } from '../../../packages/core/src/shared/hooks/useFeeSchedule.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import {
    ListEditRoute,
    ListForkRoute,
    ListShareRoute,
} from '../../helpers/listFormRoutes.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const LTC_OWNER = 'ltc1qcr8te4kr609gcawutmrza0j4xv80jy8z3ltc0w';
const MEMBER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const FORMATS = Object.freeze({
    0: 'VERSION|TYPE|MEMO|...ITEM',
    1: 'VERSION|EDIT|LIST_ACTION_INDEX|MEMO|...ITEM',
    2: 'VERSION|LIST_ACTION_INDEX|MEMO',
    3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
    4: 'VERSION|TYPE|NAME|DESCRIPTION|MEMO|...ITEM',
    5: 'VERSION|LIST_ACTION_INDEX|NAME|DESCRIPTION|MEMO',
});
const SCHEDULE = Object.freeze({
    gasPrice: '0.00001',
    gasSchedule: { LIST_SHARE: 100000, LIST_SHARED_EDIT_BASE: 5000, LIST_SHARED_EDIT_PER_ITEM: 100 },
    prices: { available: true, xchainUsd: '0.25', coinUsd: '98000' },
});

function address(chainAddress) {
    return {
        id: `addr-${chainAddress.slice(-4)}`,
        address: chainAddress,
        publicKey: '02aa',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        signerId: 'signer-owner',
    };
}

function detail(owner = OWNER) {
    return {
        action_index: 2700,
        type: 2,
        status: 'valid',
        source: owner,
        list_action_index: null,
        list: [MEMBER],
        state: { owner, edit_resolution_active: true, current_list: [MEMBER] },
    };
}

function makeMessaging({ chainId = BTC, owner = OWNER, ...overrides } = {}) {
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode: 'full' }], activeWalletId: 'wallet-1' });
    const record = address(owner);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [record] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [chainId]: { id: record.id } }),
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'USD' }),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'W', walletMode: 'full' }]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
        getActionFormats: vi.fn().mockResolvedValue(FORMATS),
        getListByActionIndex: vi.fn().mockResolvedValue(detail(owner)),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
        getListsForSource: vi.fn().mockResolvedValue({ data: [] }),
        getFeeSchedule: vi.fn().mockResolvedValue(SCHEDULE),
        // No live quote: the figure must come from the schedule alone.
        quoteProtocolFee: vi.fn().mockResolvedValue(null),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            object[property] = stub;
            return stub;
        },
    });
}

function mount(component, messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            {component}
        </MessagingProvider>,
    );
    return messaging;
}

const listRef = (chainId = BTC) => ({ chainId, actionIndex: '2700' });
const protocolRow = () => document.querySelector('[data-fees-row="protocol"]');
const shareFeeRow = () => document.querySelector('[data-share-fee]');
// Speed and Fees starts closed; its controls are reachable once it opens.
const openFees = () => fireEvent.click(screen.getByRole('button', { name: /^Speed and Fees/ }));

beforeEach(() => {
    __clearFeeScheduleCache();
    __clearTokenInfoCache();
    fiat.priced = true;
    ownerRun.mockReset();
    ownerRun.mockResolvedValue({});
});

afterEach(() => {
    cleanup();
    resetWalletModes();
    vi.clearAllMocks();
});

describe('List form: Share, fee before review', () => {
    it('shows the share fee in XCHAIN with its fiat value', async () => {
        mount(<ListShareRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />, makeMessaging());
        await screen.findByRole('button', { name: 'Share List' });
        await waitFor(() => expect(shareFeeRow()).toHaveTextContent('1 XCHAIN ~$0.25'));
        expect(shareFeeRow().textContent).not.toMatch(/gas/);
    });

    it('shows the XCHAIN amount alone when there is no price', async () => {
        fiat.priced = false;
        mount(<ListShareRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />, makeMessaging());
        await screen.findByRole('button', { name: 'Share List' });
        await waitFor(() => expect(shareFeeRow().textContent).toBe('1 XCHAIN'));
    });

    it('shows the protocol fee in Speed and Fees before review, never Priced at review', async () => {
        mount(<ListShareRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />, makeMessaging());
        await screen.findByRole('button', { name: 'Share List' });
        await waitFor(() => expect(protocolRow()).toHaveTextContent('1 XCHAIN'));
        expect(protocolRow()).toHaveTextContent('~$0.25');
        expect(document.body.textContent).not.toMatch(/Priced at review/);
        // The standard slider (G20, G113): a share is an ordinary transaction.
        openFees();
        expect(screen.getByRole('slider', { name: 'Network fee' })).toBeTruthy();
    });

    it('shows the fee even while the form cannot be submitted (not the owner)', async () => {
        mount(
            <ListShareRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />,
            makeMessaging({ getListByActionIndex: vi.fn().mockResolvedValue(detail('bc1qsomeoneelse')) }),
        );
        expect(await screen.findByText(/is not an address in this wallet/i)).toBeTruthy();
        await waitFor(() => expect(protocolRow()).toHaveTextContent('1 XCHAIN'));
        expect(shareFeeRow()).toHaveTextContent('1 XCHAIN');
    });

    it('keeps the pay-in-coin choice and sends it, with the speed, to the share', async () => {
        mount(<ListShareRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />, makeMessaging());
        const action = await screen.findByRole('button', { name: 'Share List' });
        openFees();
        const toggle = screen.getByRole('switch', { name: 'Pay protocol fee in BTC' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        // Paid in BTC, the converted amount sits under the switch label.
        await waitFor(() => expect(document.body.textContent).toMatch(/0\.00000255 BTC/));

        fireEvent.click(action);
        await waitFor(() => expect(ownerRun).toHaveBeenCalledTimes(1));
        const { encoderOpts, submitExtra } = ownerRun.mock.calls[0][0];
        expect(encoderOpts.payFeeInNativeCoin).toBe(true);
        expect(submitExtra.payFeeInNativeCoin).toBe(true);
        expect(Number(encoderOpts.feePerKb)).toBeGreaterThan(0);
    });

    it('on Litecoin with no oracle price, still shows the fee in XCHAIN; only the coin amount waits', async () => {
        mount(
            <ListShareRoute walletId="wallet-1" listRef={listRef(LTC)} onBack={() => {}} />,
            makeMessaging({
                chainId: LTC,
                owner: LTC_OWNER,
                getFeeSchedule: vi.fn().mockResolvedValue({ ...SCHEDULE, prices: { available: false } }),
            }),
        );
        await screen.findByRole('button', { name: 'Share List' });
        openFees();
        const toggle = screen.getByRole('switch', { name: 'Pay protocol fee in LTC' });
        // On and locked: the native output is the protocol fee on Litecoin.
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(toggle).toBeDisabled();
        await waitFor(() => expect(protocolRow()).toHaveTextContent('1 XCHAIN'));
        expect(protocolRow().textContent).not.toMatch(/Priced at review/);
        expect(document.body.textContent).toMatch(/Priced at review/);
    });

    it('reads the fee schedule once, however often the form renders', async () => {
        const messaging = makeMessaging();
        mount(<ListShareRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />, messaging);
        await screen.findByRole('button', { name: 'Share List' });
        await waitFor(() => expect(protocolRow()).toHaveTextContent('1 XCHAIN'));
        const memo = screen.getByLabelText(/^Memo/);
        for (const value of ['a', 'ab', 'abc', 'abcd']) fireEvent.change(memo, { target: { value } });
        openFees();
        fireEvent.click(screen.getByRole('switch', { name: 'Pay protocol fee in BTC' }));
        await waitFor(() => expect(memo).toHaveValue('abcd'));
        expect(messaging.getFeeSchedule).toHaveBeenCalledTimes(1);
        expect(messaging.getSharedLists).toHaveBeenCalledTimes(1);
    });
});

describe('sibling list forms, fee before review', () => {
    it('Create reads Free from the start, with no items entered', async () => {
        mount(<ListCreateForm walletId="wallet-1" chainId={BTC} onBack={() => {}} />, makeMessaging());
        await waitFor(() => expect(protocolRow()).toHaveTextContent('Free'));
        expect(document.body.textContent).not.toMatch(/Priced at review/);
    });

    it('Edit of an unshared list reads Free', async () => {
        mount(<ListEditRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />, makeMessaging());
        await waitFor(() => expect(protocolRow()).toHaveTextContent('Free'));
        expect(document.body.textContent).not.toMatch(/Priced at review/);
    });

    it('Edit of a shared list shows the shared-edit fee before anything is entered', async () => {
        mount(
            <ListEditRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />,
            makeMessaging({
                getSharedLists: vi.fn().mockResolvedValue({
                    lists: [{ kind: 'home', home_chain: 'BTC', home_list_index: 2700 }],
                }),
            }),
        );
        // The base alone (5,000 gas): a memo-only edit costs exactly this.
        await waitFor(() => expect(protocolRow()).toHaveTextContent('0.05 XCHAIN'));
        expect(document.body.textContent).not.toMatch(/Priced at review/);
    });

    it('Edit of a shared list adds the per-item gas for each member added', async () => {
        mount(
            <ListEditRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />,
            makeMessaging({
                getSharedLists: vi.fn().mockResolvedValue({
                    lists: [{ kind: 'home', home_chain: 'BTC', home_list_index: 2700 }],
                }),
            }),
        );
        await waitFor(() => expect(protocolRow()).toHaveTextContent('0.05 XCHAIN'));
        // Two new members and one already on the list: 5,000 + 2 x 100 gas.
        fireEvent.change(screen.getByLabelText(/^Addresses/), {
            target: { value: `${MEMBER}\n${OWNER}\nbc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4` },
        });
        await waitFor(() => expect(protocolRow()).toHaveTextContent('0.052 XCHAIN'));
    });

    it('Fork by the owner of a shared list pays the shared-edit fee too', async () => {
        mount(
            <ListForkRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />,
            makeMessaging({
                getSharedLists: vi.fn().mockResolvedValue({
                    lists: [{ kind: 'home', home_chain: 'BTC', home_list_index: 2700 }],
                }),
            }),
        );
        await waitFor(() => expect(protocolRow()).toHaveTextContent('0.05 XCHAIN'));
    });

    it('Fork of a list this wallet does not own is a new list, so it reads Free', async () => {
        mount(
            <ListForkRoute walletId="wallet-1" listRef={listRef()} onBack={() => {}} />,
            makeMessaging({ getListByActionIndex: vi.fn().mockResolvedValue(detail('bc1qsomeoneelse')) }),
        );
        await waitFor(() => expect(protocolRow()).toHaveTextContent('Free'));
        expect(document.body.textContent).not.toMatch(/Priced at review/);
    });
});
