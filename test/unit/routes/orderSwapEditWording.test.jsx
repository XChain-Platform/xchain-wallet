// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { formatLocalDateTime } from '../../../packages/core/src/shared/utils/dateTime.js';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { MySwapsWithDetail } from '../mySwapsWithDetail.jsx';

const CHAIN = 'dogecoin-testnet';
const OWNER = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const CURRENT_EXPIRATION = 1893456000;
const EDIT_VALUE = '2030-01-02T03:04';
const EDIT_EXPIRATION = String(Math.floor(Date.parse(EDIT_VALUE) / 1000));

const ADDRESS = Object.freeze({
    id: 'address-1',
    address: OWNER,
    publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function marketRow() {
    return {
        action_index: '700',
        source: OWNER,
        give_tick: 'DOGESWAP',
        give_coin: 'DOGE',
        give_amount: '500',
        give_ownership: 0,
        get_tick: 'OTHER',
        get_coin: 'DOGE',
        get_amount: '10',
        get_ownership: 0,
        expiration: CURRENT_EXPIRATION,
        block_index: '67882087',
        status: 'valid',
    };
}

const VIEWS = [
    {
        noun: 'order',
        Component: MyOrdersView,
        indexKey: 'ORDER_ACTION_INDEX',
        submitMethods: ['cancelOrder', 'editOrder'],
        feeds: {
            getOrdersForAddress: vi.fn(async () => ({ data: [marketRow()] })),
            getOrderCancelsForAddress: vi.fn(async () => ({ data: [] })),
            // The explorer's order detail: the order's own fields and its state.
            getOrderDetail: vi.fn(async () => ({
                ...marketRow(),
                state: { status: 'open', expiration: CURRENT_EXPIRATION, give_remaining: '500' },
            })),
            listAutopayOrders: vi.fn(async () => []),
        },
        // Cancel and Edit live on the order's detail page, which its row opens.
        detailPage: true,
    },
    {
        noun: 'swap',
        // The list with its rows opening Swap Details, as the shells wire it.
        Component: MySwapsWithDetail,
        indexKey: 'SWAP_ACTION_INDEX',
        submitMethods: ['swapAction'],
        feeds: {
            getSwapsForAddress: vi.fn(async () => ({ data: [marketRow()] })),
            getSwapCancelsForAddress: vi.fn(async () => ({ data: [] })),
            // The explorer's swap detail: the swap's own fields and its state.
            getSwapDetail: vi.fn(async () => ({
                ...marketRow(),
                action: 'SWAP',
                state: { status: 'open', expiration: CURRENT_EXPIRATION },
            })),
        },
        // Cancel and Edit live on the swap's details page, which its row opens.
        detailPage: true,
        listName: 'Swaps',
    },
];

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function mount(view) {
    const composeForConfirm = vi.fn(async ({ actionData }) => {
        const expiration = actionData.params.EXPIRATION;
        return {
            psbt: 'aa00',
            encoding: 'psbt',
            actionString: 'ACT',
            version: actionData.params.VERSION,
            chainId: CHAIN,
            decoded: {
                summary: expiration
                    ? `Edit ${view.noun} #700, expiration ${expiration}`
                    : `Cancel ${view.noun} #700`,
                details: expiration ? [{ label: 'Expiration', value: expiration }] : [],
                warnings: [],
            },
        };
    });
    const methods = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN]: [ADDRESS] })),
        getSettings: vi.fn(async () => ({ walletMode: 'full' })),
        signerReady: vi.fn(async () => ({ ready: true })),
        getSignerStatus: vi.fn(async () => ({ status: 'unlocked' })),
        listWallets: vi.fn(async () => []),
        composeForConfirm,
        preflight: vi.fn(async () => ({ verdict: 'pass', findings: [] })),
        ...view.feeds,
    };
    for (const method of view.submitMethods) {
        methods[method] = vi.fn(async ({ params }) => ({
            broadcast: {
                txid: `tx-${view.noun}-${method.includes('cancel') || params?.VERSION === '1' ? 'cancel' : 'edit'}`,
            },
        }));
    }
    const messaging = new Proxy(methods, {
        get(target, property) {
            if (property in target) return target[property];
            return vi.fn(async () => null);
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <view.Component walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return { methods, composeForConfirm };
}

async function openAction(view, label) {
    if (view.detailPage) {
        const orders = await screen.findByRole('list', { name: view.listName || 'Orders' });
        fireEvent.click(within(orders).getByRole('button'));
        // The detail page's action rows (G101) are named by their title, then their description.
        fireEvent.click(await screen.findByRole('button', {
            name: new RegExp(`^${label} ${view.noun}`),
        }));
        return;
    }
    const list = await screen.findByRole('list', { name: `Open ${view.noun}s` });
    fireEvent.click(within(list).getByRole('button', { name: label }));
}

async function approve() {
    const button = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
}

function expectExplorerLink(txid) {
    expect(screen.getByText('Transaction ID')).toBeTruthy();
    expect(screen.getByText(txid)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'View on explorer ↗' });
    expect(link).toHaveAttribute('href', expect.stringMatching(new RegExp(`/TDOGE/tx/${txid}$`)));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
}

describe.each(VIEWS)('$noun action wording', (view) => {
    it('describes the date picker and formats expiration on confirmation', async () => {
        const { composeForConfirm } = mount(view);
        await openAction(view, 'Edit');

        fireEvent.click(screen.getByRole('button', { name: 'About New expiration' }));
        expect(screen.getByRole('tooltip'))
            .toHaveTextContent('Leave it blank to keep the current expiration');
        fireEvent.change(screen.getByLabelText('New expiration', { selector: 'input' }), {
            target: { value: EDIT_VALUE },
        });
        fireEvent.click(screen.getByRole('button', { name: `Update ${view.noun[0].toUpperCase()}${view.noun.slice(1)}` }));

        // The decoded Expiration row is a facts card row (G127).
        const intent = await screen.findByTestId('confirm-facts');
        const formatted = formatLocalDateTime(Number(EDIT_EXPIRATION));
        expect(intent).toHaveTextContent(formatted);
        expect(intent).not.toHaveTextContent(EDIT_EXPIRATION);
        expect(composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            actionData: expect.objectContaining({
                params: expect.objectContaining({
                    VERSION: '2',
                    [view.indexKey]: '700',
                    EXPIRATION: EDIT_EXPIRATION,
                }),
            }),
        }));

        await approve();
        await screen.findByText('Edit broadcast');
        expectExplorerLink(`tx-${view.noun}-edit`);
    });

    it('shows the cancel broadcast transaction with an explorer link', async () => {
        mount(view);
        await openAction(view, 'Cancel');
        fireEvent.click(screen.getByRole('button', { name: `Cancel ${view.noun[0].toUpperCase()}${view.noun.slice(1)}` }));
        await approve();

        await screen.findByText('Cancel broadcast');
        expectExplorerLink(`tx-${view.noun}-cancel`);
    });
});

describe('My orders cancel refresh', () => {
    it('keeps a broadcast cancel out of Open while the explorer feed catches up', async () => {
        const view = VIEWS[0];
        mount(view);
        await openAction(view, 'Cancel');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel Order' }));
        await approve();

        await screen.findByText('Cancel broadcast');
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        // Done returns to the order's detail, Closing and with no Cancel.
        const card = await screen.findByRole('region', { name: 'Order' });
        await waitFor(() => expect(within(card).getByText('Closing')).toBeTruthy());
        expect(screen.queryByRole('button', { name: /^Cancel order/ })).toBeNull();

        // The list still reads Closing once it reloads.
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        const orders = await screen.findByRole('list', { name: 'Orders' });
        expect(await within(orders).findByText('Closing')).toBeTruthy();
        expect(screen.queryByRole('list', { name: 'Open orders' })).toBeNull();
    });
});
