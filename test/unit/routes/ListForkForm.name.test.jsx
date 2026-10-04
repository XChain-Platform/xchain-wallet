// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';

const { submitConfirmed } = vi.hoisted(() => ({ submitConfirmed: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', () => ({
    isUserRejection: () => false,
    useConfirmSubmit: () => submitConfirmed,
    useActionConfirmFlow: () => ({
        open: false,
        composing: false,
        confirmAction: {},
        run: ({ onApprove }) => onApprove({ psbt: '70736274ff' }),
    }),
}));

const CHAIN = 'dogecoin-mainnet';
const ADDRESS = {
    id: 'doge-0',
    address: 'DExampleExampleExampleExampleExample',
    publicKey: '02aa',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const CURRENT_ITEMS = ['KEEP', 'REMOVE'];

function mountFork({ name, listRead = 'available', walletMode = 'watcher', getActionByTxid = vi.fn() } = {}) {
    const row = {
        action_index: 2700,
        type: '1',
        source: ADDRESS.address,
        list: CURRENT_ITEMS,
        state: {
            edit_resolution_active: true,
            current_list: CURRENT_ITEMS,
            owner: ADDRESS.address,
        },
        ...(name === undefined ? {} : { name }),
    };
    const getListByActionIndex = listRead === 'missing'
        ? undefined
        : listRead === 'failed'
            ? vi.fn().mockRejectedValue(new Error('list read failed'))
            : vi.fn().mockResolvedValue(row);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode, activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: walletMode === 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: walletMode === 'full' ? 'unlocked' : 'locked' }),
        getListByActionIndex,
        getActionByTxid,
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
    };
    const messaging = new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });

    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListForkForm
                walletId="wallet-1"
                listRef={{
                    chainId: CHAIN,
                    actionIndex: '2700',
                    type: '1',
                    items: CURRENT_ITEMS,
                    editResolutionActive: true,
                    source: ADDRESS.address,
                    parentIndex: null,
                }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
    return { messaging, getListByActionIndex };
}

async function openFirstReview() {
    fireEvent.change(await screen.findByLabelText(/Add tokens/), { target: { value: 'ADD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListForkForm list names', () => {
    it('shows a named list in the first review without adding a detail read', async () => {
        const { getListByActionIndex } = mountFork({ name: 'Treasury wallets' });

        await waitFor(() => expect(getListByActionIndex).toHaveBeenCalledTimes(1));
        await openFirstReview();

        expect(await screen.findByText('Treasury wallets (List #2700)')).toBeTruthy();
        expect(getListByActionIndex).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['an unnamed detail', undefined],
        ['an empty name', ''],
    ])('keeps the numeric review label for %s', async (_label, name) => {
        mountFork({ name });
        await openFirstReview();

        expect(await screen.findByText('#2700')).toBeTruthy();
        expect(screen.queryByText('List #2700')).toBeNull();
    });

    it.each([
        ['a host without the detail read', 'missing'],
        ['a failed detail read', 'failed'],
    ])('keeps the numeric review label for %s', async (_label, listRead) => {
        mountFork({ listRead });
        await openFirstReview();

        expect(await screen.findByText('#2700')).toBeTruthy();
        expect(screen.queryByText('List #2700')).toBeNull();
    });

    it('neutralizes bidi controls in a named review label', async () => {
        mountFork({ name: 'Treasury\u202Eevil' });
        await openFirstReview();

        expect(await screen.findByText('Treasury␦evil (List #2700)')).toBeTruthy();
        expect(screen.queryByText('Treasury\u202Eevil (List #2700)')).toBeNull();
    });

    it('uses the original name with the intermediate index in the second review', async () => {
        let finishIndexing;
        const indexed = new Promise((resolve) => { finishIndexing = resolve; });
        submitConfirmed.mockResolvedValueOnce({ txid: 'add-tx' });
        mountFork({
            name: 'Treasury wallets',
            walletMode: 'full',
            getActionByTxid: vi.fn(() => indexed),
        });

        fireEvent.click(await screen.findByRole('checkbox', { name: 'REMOVE' }));
        await openFirstReview();
        expect(await screen.findByText('Treasury wallets (List #2700)')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Publish add' }));
        await screen.findByText('First transaction (add)');
        await act(async () => { finishIndexing({ action_index: 2701 }); });

        expect(await screen.findByText('Treasury wallets (List #2701)')).toBeTruthy();
    });
});
