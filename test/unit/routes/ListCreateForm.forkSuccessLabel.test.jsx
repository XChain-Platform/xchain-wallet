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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
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
const CURRENT_ROW = {
    action_index: 2700,
    type: '1',
    source: ADDRESS.address,
    list: CURRENT_ITEMS,
    state: { edit_resolution_active: true, current_list: CURRENT_ITEMS },
};

function mountFork({ getActionByTxid = vi.fn() } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue(CURRENT_ROW),
        getActionByTxid,
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
}

async function reviewAndPublishFirst() {
    fireEvent.click(screen.getByRole('button', { name: /^Publish fork$/i }));
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListForkForm success transaction labels', () => {
    it('labels an add-only fork as one fork transaction', async () => {
        submitConfirmed.mockResolvedValueOnce({ txid: 'add-only-tx' });
        mountFork();

        fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'ADD' } });
        await reviewAndPublishFirst();

        expect(await screen.findByText('Fork transaction')).toBeTruthy();
        expect(screen.queryByText('First transaction (add)')).toBeNull();
    });

    it('labels a remove-only fork as one remove transaction', async () => {
        submitConfirmed.mockResolvedValueOnce({ txid: 'remove-only-tx' });
        mountFork();

        fireEvent.click(await screen.findByRole('radio', { name: 'Remove' }));
        fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'REMOVE' } });
        await reviewAndPublishFirst();

        expect(await screen.findByText('Fork transaction (remove)')).toBeTruthy();
        expect(screen.queryByText('First transaction (add)')).toBeNull();
    });

    // Fork shares Edit's one Add | Remove toggle, so one fork is never both.
    it('never labels a fork as add first and remove second', async () => {
        submitConfirmed.mockResolvedValueOnce({ txid: 'add-tx' });
        mountFork();

        fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'ADD' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Remove' }));
        expect(screen.getByLabelText('Tokens')).toHaveValue('');
        fireEvent.change(screen.getByLabelText('Tokens'), { target: { value: 'REMOVE' } });
        await reviewAndPublishFirst();

        expect(await screen.findByText('Fork transaction (remove)')).toBeTruthy();
        expect(screen.queryByText('First transaction (add)')).toBeNull();
        expect(screen.queryByText('Second transaction (remove)')).toBeNull();
    });
});
