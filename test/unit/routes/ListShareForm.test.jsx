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
import { ListShareForm } from '../../../packages/core/src/shared/routes/ListShareForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const ROOT_OWNER = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const OWNER_RECORD = Object.freeze({
    id: 'owner-address',
    address: OWNER,
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-owner',
});
const ROOT_OWNER_RECORD = Object.freeze({
    id: 'root-owner-address',
    address: ROOT_OWNER,
    publicKey: '02cc',
    derivationPath: "m/44'/0'/0'/0/2",
    source: 'hd',
    signerId: 'signer-root-owner',
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
    actionString: 'LIST|2|2700|worldwide',
    version: 1,
});

function baseDetail(overrides = {}) {
    return {
        action_index: 2700,
        type: 2,
        source: OWNER,
        list_action_index: null,
        list: ['bc1qmember'],
        state: { owner: OWNER, edit_resolution_active: true, current_list: ['bc1qmember'] },
        ...overrides,
    };
}

function makeMessaging({ detail = baseDetail(), shared = { lists: [] }, addresses } = {}) {
    const rows = addresses || [ACTIVE_RECORD, OWNER_RECORD, ROOT_OWNER_RECORD];
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: rows }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn(async ({ actionIndex }) => {
            if (String(actionIndex) === '2700') return detail;
            if (String(actionIndex) === '2600') {
                return { action_index: 2600, type: 2, source: ROOT_OWNER, list_action_index: null };
            }
            return null;
        }),
        getSharedLists: vi.fn().mockResolvedValue(shared),
        getActionFormats: vi.fn().mockResolvedValue({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            2: 'VERSION|LIST_ACTION_INDEX|MEMO',
            3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
        }),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn().mockResolvedValue({ txid: 'share-txid' }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'bb00' }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount({
    support = { share: true, transfer: true, union: true },
    ...messagingOptions
} = {}) {
    listFormatSupport.mockResolvedValue(support);
    const messaging = makeMessaging(messagingOptions);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListShareForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex: '2700' }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListShareForm', () => {
    it.each([
        [
            'a union',
            { detail: baseDetail({ type: 3 }) },
            'A union list cannot be shared in this release.',
        ],
        [
            'an unsupported type',
            { detail: baseDetail({ type: 4 }) },
            'Only token and address lists can be shared.',
        ],
        [
            'an already shared list',
            {
                shared: {
                    lists: [{ kind: 'home', home_chain: 'BTC', home_list_index: 2700 }],
                },
            },
            'This list is already shared; a shared list cannot be shared again.',
        ],
        [
            'a list over the member cap',
            {
                detail: baseDetail({
                    state: {
                        owner: OWNER,
                        edit_resolution_active: true,
                        current_list: Array.from({ length: 10001 }, (_, index) => `member-${index}`),
                    },
                }),
            },
            'A list over 10,000 members cannot be shared.',
        ],
    ])('shows the refusal and disables Review for %s', async (_case, options, reason) => {
        const messaging = mount(options);

        expect(await screen.findByText(reason)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true);
        expect(screen.getByLabelText('Memo (optional)').disabled).toBe(true);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('requires the case-sensitive SHARE confirmation before Review', async () => {
        const messaging = mount();
        const confirm = await screen.findByLabelText('Type SHARE to confirm');
        const review = screen.getByRole('button', { name: 'Review' });

        expect(review.disabled).toBe(true);
        fireEvent.change(confirm, { target: { value: 'share' } });
        expect(review.disabled).toBe(true);
        fireEvent.change(confirm, { target: { value: ' SHARE ' } });
        expect(review.disabled).toBe(false);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('uses the reported owner, shows the fee choice, and composes format 2 through createList', async () => {
        const messaging = mount();
        const feeChoice = await screen.findByLabelText('Pay protocol fee in BTC instead of XCHAIN');
        fireEvent.click(feeChoice);
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: ' worldwide ' } });
        fireEvent.change(screen.getByLabelText('Type SHARE to confirm'), { target: { value: 'SHARE' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const request = messaging.composeForConfirm.mock.calls[0][0];
        expect(request.from.address).toBe(OWNER);
        expect(request.actionData).toEqual({
            action: 'LIST',
            params: {
                VERSION: '2',
                LIST_ACTION_INDEX: '2700',
                MEMO: 'worldwide',
            },
        });
        expect(request.encoderOpts).toEqual({ payFeeInNativeCoin: true });
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
                VERSION: '2',
                LIST_ACTION_INDEX: '2700',
                MEMO: 'worldwide',
            },
            payFeeInNativeCoin: true,
            prebuiltPsbt: { psbtHex: 'aa00', encoding: 'psbt' },
        });
    });

    it('walks to the root owner when state.owner is absent', async () => {
        const messaging = mount({
            detail: baseDetail({
                source: ACTIVE_RECORD.address,
                list_action_index: '2600',
                state: { edit_resolution_active: true, current_list: ['bc1qmember'] },
            }),
        });

        fireEvent.change(await screen.findByLabelText('Type SHARE to confirm'), {
            target: { value: 'SHARE' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));

        expect(messaging.getListByActionIndex).toHaveBeenCalledWith({
            chainId: CHAIN,
            actionIndex: '2600',
        });
        expect(messaging.composeForConfirm.mock.calls[0][0].from.address).toBe(ROOT_OWNER);
    });

    it('warns when the wallet does not hold the owner', async () => {
        mount({ addresses: [ACTIVE_RECORD] });

        expect(await screen.findByText(/current owner.*is not an address in this wallet/i)).toBeTruthy();
        expect(screen.getByText(/share signed by another address will be refused/i)).toBeTruthy();
    });

    it.each([
        ['false', { share: false, transfer: true, union: true }],
        ['absent', { transfer: true, union: true }],
    ])('renders disabled with the SDK reason when share support is %s', async (_case, support) => {
        const messaging = mount({ support });

        expect(await screen.findByText(/SDK cannot build a list share yet/)).toBeTruthy();
        expect(listFormatSupport).toHaveBeenCalledWith({
            sdkRegistry: expect.objectContaining({ get: expect.any(Function) }),
            chainId: CHAIN,
        });
        expect(messaging.getActionFormats).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Memo (optional)').disabled).toBe(true);
        expect(screen.getByLabelText('Type SHARE to confirm').disabled).toBe(true);
        expect(screen.getByLabelText('Pay protocol fee in BTC instead of XCHAIN').disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true);
    });
});
