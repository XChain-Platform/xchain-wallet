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
import { cleanup, render, screen } from '@testing-library/react';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListShareForm } from '../../../packages/core/src/shared/routes/ListShareForm.jsx';

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

function detailWith(nameMarker) {
    const detail = {
        action_index: 2700,
        type: 2,
        source: OWNER,
        list_action_index: null,
        list: ['bc1qmember'],
        state: { owner: OWNER, edit_resolution_active: true, current_list: ['bc1qmember'] },
    };
    if (nameMarker !== undefined) detail.name = nameMarker;
    return detail;
}

function makeMessaging(detail) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER_RECORD] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue(detail),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
        getActionFormats: vi.fn().mockResolvedValue({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            2: 'VERSION|LIST_ACTION_INDEX|MEMO',
            3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
        }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(nameMarker) {
    listFormatSupport.mockResolvedValue({ share: true, transfer: true, union: true });
    render(
        <MessagingProvider shell="web" messaging={makeMessaging(detailWith(nameMarker))}>
            <ListShareForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex: '2700' }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListShareForm name', () => {
    it('shows the loaded list name directly after the list row', async () => {
        mount('Treasury');

        const nameLabel = await screen.findByText('Name', { selector: 'dt' });
        expect(nameLabel.previousElementSibling.textContent).toBe('#2700');
        expect(nameLabel.nextElementSibling.textContent).toBe('Treasury');
        expect(nameLabel.nextElementSibling.nextElementSibling.textContent).toBe('Chain');
    });

    it.each([
        ['an absent name', undefined],
        ['an empty name', ''],
        ['a non-string name', 42],
    ])('does not show a Name row for %s', async (_case, name) => {
        mount(name);

        expect(await screen.findByText('#2700')).toBeTruthy();
        expect(screen.queryByText('Name', { selector: 'dt' })).toBeNull();
    });

    it('neutralizes bidi controls in the loaded name', async () => {
        mount('Safe\u202Eevil');

        expect(await screen.findByText('Safe\u2426evil')).toBeTruthy();
        expect(screen.queryByText('Safe\u202Eevil')).toBeNull();
    });
});
