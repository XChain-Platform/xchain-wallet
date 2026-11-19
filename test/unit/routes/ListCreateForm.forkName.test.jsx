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
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ListForkRoute as ListForkForm } from '../../helpers/listFormRoutes.jsx';

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
// The right-to-left override, built from its code point so no bidi control sits in this source.
const RLO = String.fromCharCode(0x202e);

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
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode }], activeWalletId: 'wallet-1' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'W', walletMode }]),
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
    fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'ADD' } });
    fireEvent.click(screen.getByRole('button', { name: /^Publish fork$/i }));
}

afterEach(() => {
    cleanup();
    resetWalletModes();
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
        ['an unnamed detail', { name: undefined }],
        ['an empty name', { name: '' }],
        ['a host without the detail read', { listRead: 'missing' }],
    ])('keeps the numeric review label for %s', async (_label, options) => {
        mountFork(options);
        await openFirstReview();

        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent(/list #2700/i);
    });

    it('shows a plain load error instead of a review when the list read fails', async () => {
        mountFork({ listRead: 'failed' });

        expect(await screen.findByText(/Couldn't load list #2700/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Publish fork$/i })).toBeNull();
    });

    it('neutralizes bidi controls in a named review label', async () => {
        mountFork({ name: `Treasury${RLO}evil` });
        await openFirstReview();

        expect(await screen.findByText('Treasury␦evil (List #2700)')).toBeTruthy();
        expect(screen.queryByText(`Treasury${RLO}evil (List #2700)`)).toBeNull();
    });

    // The second review (original name, intermediate index) needs an add and
    // a remove in one fork; Fork now carries one direction, so it is gone.
});
