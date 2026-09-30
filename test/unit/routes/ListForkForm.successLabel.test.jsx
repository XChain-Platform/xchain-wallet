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
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const publish = await screen.findByRole('button', { name: /^Publish (add|remove)$/ });
    fireEvent.click(publish);
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListForkForm success transaction labels', () => {
    it('labels an add-only fork as one fork transaction', async () => {
        submitConfirmed.mockResolvedValueOnce({ txid: 'add-only-tx' });
        mountFork();

        fireEvent.change(await screen.findByLabelText(/Add tokens/), { target: { value: 'ADD' } });
        await reviewAndPublishFirst();

        expect(await screen.findByText('Fork transaction')).toBeTruthy();
        expect(screen.queryByText('First transaction (add)')).toBeNull();
    });

    it('labels a remove-only fork as one remove transaction', async () => {
        submitConfirmed.mockResolvedValueOnce({ txid: 'remove-only-tx' });
        mountFork();

        fireEvent.click(await screen.findByRole('checkbox', { name: 'REMOVE' }));
        await reviewAndPublishFirst();

        expect(await screen.findByText('Fork transaction (remove)')).toBeTruthy();
        expect(screen.queryByText('First transaction (add)')).toBeNull();
    });

    it('labels only a two-phase fork as add first and remove second', async () => {
        let finishIndexing;
        const indexed = new Promise((resolve) => { finishIndexing = resolve; });
        submitConfirmed
            .mockResolvedValueOnce({ txid: 'add-tx' })
            .mockResolvedValueOnce({ txid: 'remove-tx' });
        mountFork({ getActionByTxid: vi.fn(() => indexed) });

        fireEvent.click(await screen.findByRole('checkbox', { name: 'REMOVE' }));
        fireEvent.change(screen.getByLabelText(/Add tokens/), { target: { value: 'ADD' } });
        await reviewAndPublishFirst();

        expect(await screen.findByText('First transaction (add)')).toBeTruthy();
        await act(async () => { finishIndexing({ action_index: 2701 }); });
        fireEvent.click(await screen.findByRole('button', { name: 'Publish remove' }));

        expect(await screen.findByText('First transaction (add)')).toBeTruthy();
        expect(screen.getByText('Second transaction (remove)')).toBeTruthy();
    });
});
