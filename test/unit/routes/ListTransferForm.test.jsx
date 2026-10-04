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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListTransferForm } from '../../../packages/core/src/shared/routes/ListTransferForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const DESTINATION = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const OWNER_RECORD = Object.freeze({
    id: 'owner-address',
    address: OWNER,
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-owner',
});
const ACTIVE_RECORD = Object.freeze({
    id: 'active-address',
    address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
    publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/1",
    source: 'hd',
    signerId: 'signer-active',
});
const COMPOSED = Object.freeze({
    psbt: 'aa00',
    encoding: 'psbt',
    actionString: `LIST|3|2700|${DESTINATION}|handoff`,
    version: 1,
});

function makeMessaging({ walletMode = 'full' } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ACTIVE_RECORD, OWNER_RECORD] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue({
            action_index: 2700,
            source: OWNER,
            state: { owner: OWNER },
        }),
        getActionFormats: vi.fn().mockResolvedValue({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            2: 'VERSION|LIST_ACTION_INDEX|MEMO',
            3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
        }),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn().mockResolvedValue({ txid: 'transfer-txid' }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'bb00' }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount({ support = { share: true, transfer: true, union: true }, ...options } = {}) {
    listFormatSupport.mockResolvedValue(support);
    const messaging = makeMessaging(options);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListTransferForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex: '2700', source: OWNER }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

async function fillTransfer({ destination = DESTINATION, memo = '' } = {}) {
    fireEvent.change(await screen.findByLabelText('Destination'), { target: { value: destination } });
    if (memo) fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: memo } });
    fireEvent.change(screen.getByLabelText('Type TRANSFER to confirm'), { target: { value: 'TRANSFER' } });
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListTransferForm', () => {
    it('refuses malformed and current-owner destinations', async () => {
        const messaging = mount();
        await fillTransfer({ destination: 'not-an-address' });

        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText(/Destination must be one valid address/)).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Destination'), { target: { value: OWNER } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText('Destination must be different from the current owner.')).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('requires typing TRANSFER before Review', async () => {
        const messaging = mount();
        fireEvent.change(await screen.findByLabelText('Destination'), { target: { value: DESTINATION } });

        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Type TRANSFER to confirm'), { target: { value: 'transfer' } });
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(false);
    });

    it('composes format 3 from the current owner and submits it through createList', async () => {
        const messaging = mount();
        await fillTransfer({ memo: 'handoff' });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const request = messaging.composeForConfirm.mock.calls[0][0];
        expect(request.from.address).toBe(OWNER);
        expect(request.actionData).toEqual({
            action: 'LIST',
            params: {
                VERSION: '3',
                LIST_ACTION_INDEX: '2700',
                DESTINATION,
                MEMO: 'handoff',
            },
        });
        expect(messaging.createList).not.toHaveBeenCalled();

        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve.disabled).toBe(false));
        fireEvent.click(approve);

        await waitFor(() => expect(messaging.createList).toHaveBeenCalledTimes(1));
        expect(messaging.createList.mock.calls[0][0]).toMatchObject({
            walletId: 'wallet-1',
            chainId: CHAIN,
            from: { address: OWNER },
            params: {
                VERSION: '3',
                LIST_ACTION_INDEX: '2700',
                DESTINATION,
                MEMO: 'handoff',
            },
            prebuiltPsbt: { psbtHex: 'aa00', encoding: 'psbt' },
        });
    });

    it.each([
        ['false', { share: true, transfer: false, union: true }],
        ['absent', { share: true, union: true }],
    ])('renders disabled with the SDK reason when transfer support is %s', async (_case, support) => {
        const messaging = mount({ support });

        expect(await screen.findByText(/SDK cannot build a list transfer yet/)).toBeTruthy();
        expect(listFormatSupport).toHaveBeenCalledWith({
            sdkRegistry: expect.objectContaining({ get: expect.any(Function) }),
            chainId: CHAIN,
        });
        expect(messaging.getActionFormats).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Destination').disabled).toBe(true);
        expect(screen.getByLabelText('Type TRANSFER to confirm').disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true);
    });
});
