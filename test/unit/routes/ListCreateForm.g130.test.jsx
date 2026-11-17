// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const formatSupport = vi.hoisted(() => ({
    listFormatSupport: vi.fn(),
    listMetaSupported: vi.fn(),
}));

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => formatSupport);

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = Object.freeze({
    id: 'owner-address',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-owner',
});
const EXTERNAL_OWNER = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';

function listDetail(owner = OWNER.address) {
    return {
        action_index: 2700,
        type: 2,
        source: owner,
        list: ['bc1qmember'],
        state: { owner, edit_resolution_active: true, current_list: ['bc1qmember'] },
    };
}

function mount(props, { owner = OWNER.address } = {}) {
    formatSupport.listFormatSupport.mockResolvedValue({ share: true, transfer: true, union: true });
    formatSupport.listMetaSupported.mockResolvedValue(true);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListsForSource: vi.fn().mockResolvedValue({
            data: [{ action_index: 101, type: 1, members: ['AAA'] }],
        }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [], unavailable: [] }),
        getListByActionIndex: vi.fn().mockImplementation(({ actionIndex }) => Promise.resolve(
            String(actionIndex) === '101'
                ? { action_index: 101, type: 1, state: { current_list: ['AAA'] } }
                : listDetail(owner),
        )),
        getActionFormats: vi.fn().mockResolvedValue({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            2: 'VERSION|LIST_ACTION_INDEX|MEMO',
            3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
        }),
        composeForConfirm: vi.fn(),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListCreateForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('List form G130 refusal paths', () => {
    it('keeps Create Union enabled and binds the missing member error to the picker', async () => {
        const messaging = mount({ initialType: '3' });
        const submit = await screen.findByRole('button', { name: 'Create Union List' });
        expect(submit).not.toBeDisabled();

        fireEvent.click(submit);

        expect(await within(screen.getByLabelText('Form errors')).findByText('Choose at least one member list.')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Token list #101' })).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps Share List enabled and binds an unavailable owner refusal to From', async () => {
        const messaging = mount({
            action: 'share',
            listRef: { chainId: CHAIN, actionIndex: '2700' },
        }, { owner: EXTERNAL_OWNER });
        const submit = await screen.findByRole('button', { name: 'Share List' });
        expect(submit).not.toBeDisabled();

        fireEvent.click(submit);

        expect(await within(screen.getByLabelText('Form errors')).findByText(/owned by an address that is not in this wallet/)).toBeInTheDocument();
        expect(document.getElementById('list-share-from')).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps Transfer List enabled and binds a missing destination refusal to New owner', async () => {
        const messaging = mount({
            action: 'transfer',
            listRef: { chainId: CHAIN, actionIndex: '2700', source: OWNER.address },
        });
        const submit = await screen.findByRole('button', { name: 'Transfer List' });
        expect(submit).not.toBeDisabled();

        fireEvent.click(submit);

        expect(await within(screen.getByLabelText('Form errors')).findByText(/Destination must be one valid address/)).toBeInTheDocument();
        expect(screen.getByLabelText('New owner')).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
