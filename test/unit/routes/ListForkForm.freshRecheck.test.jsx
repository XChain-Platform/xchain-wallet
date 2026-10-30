// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Review re-reads the list and stops when its members changed since the
// screen loaded, because the edit applies to the list as it is when it
// indexes. The screen read the same list moments earlier, so the re-check is
// fresh: a reused or HTTP-cached answer would be that same read.

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

describe('ListForkForm membership re-check', () => {
    it('reads the list fresh at review and ordinary when the screen loads', async () => {
        const { getListByActionIndex } = mountFork({ name: 'Treasury wallets' });
        await waitFor(() => expect(getListByActionIndex).toHaveBeenCalledTimes(1));
        expect(getListByActionIndex.mock.calls[0][0].fresh).toBeUndefined();

        await openFirstReview();

        expect(await screen.findByText('Treasury wallets (List #2700)')).toBeTruthy();
        expect(getListByActionIndex).toHaveBeenCalledTimes(2);
        expect(getListByActionIndex.mock.calls[1][0]).toEqual({ chainId: CHAIN, actionIndex: '2700', fresh: true });
    });
});
