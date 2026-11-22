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
import { ListEditRoute as ListRenameForm } from '../../helpers/listFormRoutes.jsx';

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

function makeMessaging({ detail = baseDetail(), shared = { lists: [] }, addresses, listError = null } = {}) {
    const rows = addresses || [ACTIVE_RECORD, OWNER_RECORD];
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: rows }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockImplementation(async () => {
            if (listError) throw listError;
            return detail;
        }),
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

function mount({ supported = true, supportError = false, actionIndex = '2700', ...messagingOptions } = {}) {
    if (supportError) listMetaSupported.mockRejectedValue(new Error('support lookup failed'));
    else listMetaSupported.mockResolvedValue(supported);
    const messaging = makeMessaging(messagingOptions);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListRenameForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex }}
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

// The name and description sit in Edit's Details section, closed until used.
function openDetails() {
    fireEvent.click(screen.getByRole('button', { name: /^Details\b/, expanded: false }));
}

// Renaming is the List form's Edit action: its action button is Publish Edit.
const PUBLISH = { name: /^(Publish edit|Add to list|Remove from list)$/i };

describe('ListRenameForm', () => {
    it('refuses a malformed list reference before review', async () => {
        const messaging = mount({ actionIndex: '0' });
        fireEvent.change(await screen.findByLabelText('Name'), {
            target: { value: 'Treasury' },
        });
        fireEvent.click(screen.getByRole('button', PUBLISH));

        expect(await screen.findByText('List reference must be a positive whole number.')).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('shows plain copy when the list indexer read fails', async () => {
        mount({
            listError: Object.assign(
                new Error('Explorer returned HTTP 502 for /BTC/api/lists/2700'),
                { name: 'SDKExplorerError' },
            ),
        });

        expect(await screen.findByText(/service that reads the chain is temporarily unavailable/)).toBeTruthy();
        expect(screen.queryByText(/\/BTC\/api\/lists/)).toBeNull();
    });

    it('refuses review when the SDK does not support list metadata', async () => {
        const messaging = mount({ supported: false });

        expect(await screen.findByText("Renaming lists isn't available in this version of the wallet yet.")).toBeTruthy();
        expect(listMetaSupported).toHaveBeenCalledTimes(1);
        expect(listMetaSupported).toHaveBeenCalledWith({
            sdkRegistry: expect.objectContaining({ get: expect.any(Function) }),
            chainId: CHAIN,
        });
        expect(screen.getByLabelText('Name').disabled).toBe(true);
        // Edit still publishes member changes where the name cannot change.
        expect(screen.getByRole('button', PUBLISH).disabled).toBe(false);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
    });

    it('separates a failed support check from an unavailable action', async () => {
        mount({ supportError: true });

        expect(await screen.findByText(
            "Couldn't check whether renaming lists is available right now. Reopen this page to try again.",
        )).toBeTruthy();
        expect(screen.queryByText(/isn't available in this version/)).toBeNull();
        expect(screen.getByLabelText('Name').disabled).toBe(true);
    });

    it('shows UTF-8 length and semicolon errors for the name', async () => {
        mount();
        const name = await screen.findByLabelText('Name');

        fireEvent.change(name, { target: { value: '🙂'.repeat(16) } });
        expect(screen.getByText('64 / 64')).toBeTruthy();

        fireEvent.change(name, { target: { value: '🙂'.repeat(17) } });
        expect(screen.getByText('Too long.')).toBeTruthy();

        fireEvent.change(name, { target: { value: 'bad;name' } });
        expect(screen.getByText('Cannot contain the ; character.')).toBeTruthy();
    });

    it('sets both fields to the clear sentinel', async () => {
        const messaging = mount();
        await screen.findByLabelText('Name');
        openDetails();

        // Each clear is the in-field X, shown once the field holds text.
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
        fireEvent.click(screen.getByRole('button', { name: 'Clear Name' }));
        fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'y' } });
        fireEvent.click(screen.getByRole('button', { name: 'Clear Description' }));
        fireEvent.click(screen.getByRole('button', PUBLISH));

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
        await screen.findByLabelText('Name');

        fireEvent.click(screen.getByRole('button', PUBLISH));

        expect(await screen.findByText(/^no change entered/i)).toBeTruthy();
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
        await screen.findByLabelText('Name');

        const note = screen.queryByText(/shared-list edit fee/i);
        expect(Boolean(note)).toBe(expected);
    });

    it('warns when the wallet does not hold the owner', async () => {
        mount({ addresses: [ACTIVE_RECORD] });

        // Edit's owner-only page: no edit, rename included, is valid from here.
        expect(await screen.findByText(/is owned by .*which is not an address in this wallet/i)).toBeTruthy();
        expect(screen.getByText(/This wallet cannot edit it/i)).toBeTruthy();
    });

    it('refuses a rename and a member change in one press', async () => {
        const messaging = mount();
        fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Treasury' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Remove' }));
        fireEvent.change(screen.getByLabelText('Addresses'), { target: { value: 'bc1qmember' } });
        fireEvent.click(screen.getByRole('button', PUBLISH));

        expect(await screen.findByText(/Publish one change at a time/)).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('edits with an Add or Remove toggle over one Addresses field and no members list', async () => {
        mount();
        const field = await screen.findByLabelText('Addresses');
        expect(screen.getByRole('radio', { name: 'Add' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.queryByText('Current members')).toBeNull();
        expect(screen.getByRole('button', { name: 'About Addresses' })).toBeTruthy();
        fireEvent.change(field, { target: { value: 'typed' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Remove' }));
        expect(screen.getByRole('button', { name: /^Remove from list$/i })).toBeTruthy();
        expect(screen.getByLabelText('Addresses')).toHaveValue('');
    });

    it('refuses a removal that is not on the list with a field error', async () => {
        const messaging = mount();
        await screen.findByLabelText('Addresses');
        fireEvent.click(screen.getByRole('radio', { name: 'Remove' }));
        fireEvent.change(screen.getByLabelText('Addresses'), { target: { value: OWNER } });
        expect((await screen.findAllByText(/Not on list #2700, so it cannot be removed: /)).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: /^Remove from list$/i }));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('hands the owner lane exactly the format 5 rename parameters', async () => {
        const messaging = mount();
        fireEvent.change(await screen.findByLabelText('Name'), {
            target: { value: ' Treasury ' },
        });
        fireEvent.change(screen.getByLabelText('Description'), {
            target: { value: ' Quarterly holdings ' },
        });
        fireEvent.change(screen.getByLabelText('Memo'), {
            target: { value: ' quarterly ' },
        });
        fireEvent.click(screen.getByRole('button', PUBLISH));

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
