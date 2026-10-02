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

const listMetaSupported = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listMetaSupported,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListRenameForm } from '../../../packages/core/src/shared/routes/ListRenameForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
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
    actionString: 'LIST|5|2700|Treasury|-|quarterly',
    version: 1,
});

function baseDetail(overrides = {}) {
    return {
        action_index: 2700,
        type: 2,
        source: OWNER,
        list_action_index: null,
        name: 'Old name',
        description: 'Old description',
        list: ['bc1qmember'],
        state: { owner: OWNER, edit_resolution_active: true, current_list: ['bc1qmember'] },
        ...overrides,
    };
}

function makeMessaging({ detail = baseDetail(), shared = { lists: [] }, addresses } = {}) {
    const rows = addresses || [ACTIVE_RECORD, OWNER_RECORD];
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: rows }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue(detail),
        getSharedLists: vi.fn().mockResolvedValue(shared),
        getActionFormats: vi.fn().mockResolvedValue({
            4: 'VERSION|TYPE|NAME|DESCRIPTION|MEMO|...ITEM',
            5: 'VERSION|LIST_ACTION_INDEX|NAME|DESCRIPTION|MEMO',
        }),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn().mockResolvedValue({ txid: 'rename-txid' }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'bb00' }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount({ supported = true, ...messagingOptions } = {}) {
    listMetaSupported.mockResolvedValue(supported);
    const messaging = makeMessaging(messagingOptions);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListRenameForm
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

describe('ListRenameForm', () => {
    it('refuses review when the SDK does not support list metadata', async () => {
        const messaging = mount({ supported: false });

        expect(await screen.findByText(/SDK cannot build a list rename yet/)).toBeTruthy();
        expect(listMetaSupported).toHaveBeenCalledTimes(1);
        expect(listMetaSupported).toHaveBeenCalledWith({
            sdkRegistry: expect.objectContaining({ get: expect.any(Function) }),
            chainId: CHAIN,
        });
        expect(screen.getByLabelText('Name (empty means unchanged)').disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('shows UTF-8 length and semicolon errors for the name', async () => {
        mount();
        const name = await screen.findByLabelText('Name (empty means unchanged)');

        fireEvent.change(name, { target: { value: '🙂'.repeat(16) } });
        expect(screen.getByText('64 / 64 bytes')).toBeTruthy();

        fireEvent.change(name, { target: { value: '🙂'.repeat(17) } });
        expect(screen.getByText('Too long.')).toBeTruthy();

        fireEvent.change(name, { target: { value: 'bad;name' } });
        expect(screen.getByText('Cannot contain the ; character.')).toBeTruthy();
    });

    it('sets both fields to the clear sentinel', async () => {
        const messaging = mount();
        await screen.findByLabelText('Name (empty means unchanged)');

        fireEvent.click(screen.getByRole('button', { name: 'Clear name' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear description' }));
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params).toEqual({
            VERSION: '5',
            LIST_ACTION_INDEX: '2700',
            NAME: '-',
            DESCRIPTION: '-',
            MEMO: '',
        });
    });

    it('refuses review when both metadata fields are empty', async () => {
        const messaging = mount();
        await screen.findByLabelText('Name (empty means unchanged)');

        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText(/no change/i)).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it.each([
        [
            'shared',
            { lists: [{ kind: 'home', home_chain: 'BTC', home_list_index: 2700 }] },
            true,
        ],
        ['local', { lists: [] }, false],
    ])('shows the edit-fee note only for a %s list', async (_case, shared, expected) => {
        mount({ shared });
        await screen.findByLabelText('Name (empty means unchanged)');

        const note = screen.queryByText(/shared-list edit fee/i);
        expect(Boolean(note)).toBe(expected);
    });

    it('warns when the wallet does not hold the owner', async () => {
        mount({ addresses: [ACTIVE_RECORD] });

        expect(await screen.findByText(/current owner.*is not an address in this wallet/i)).toBeTruthy();
        expect(screen.getByText(/rename signed by another address will be refused/i)).toBeTruthy();
    });

    it('hands the owner lane exactly the format 5 rename parameters', async () => {
        const messaging = mount();
        fireEvent.change(await screen.findByLabelText('Name (empty means unchanged)'), {
            target: { value: ' Treasury ' },
        });
        fireEvent.change(screen.getByLabelText('Description (empty means unchanged)'), {
            target: { value: ' Quarterly holdings ' },
        });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), {
            target: { value: ' quarterly ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0]).toMatchObject({
            chainId: CHAIN,
            from: { address: OWNER },
            actionData: {
                action: 'LIST',
                params: {
                    VERSION: '5',
                    LIST_ACTION_INDEX: '2700',
                    NAME: 'Treasury',
                    DESCRIPTION: 'Quarterly holdings',
                    MEMO: 'quarterly',
                },
            },
        });
    });
});
