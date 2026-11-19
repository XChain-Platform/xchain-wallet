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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const listMetaSupported = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({ listMetaSupported }));

const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const OTHER = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onPick, lockNetwork, title }) => (
        <section data-testid="own-address-picker" data-chain-id={chainId} data-lock={String(Boolean(lockNetwork))}>
            <h2>{title}</h2>
            <button type="button" onClick={() => onPick({ id: 'other-address', address: OTHER })}>Pick other</button>
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListEditRoute as ListRenameForm } from '../../helpers/listFormRoutes.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER_RECORD = { id: 'owner-address', address: OWNER, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1' };
const OTHER_RECORD = { id: 'other-address', address: OTHER, publicKey: '02bb', derivationPath: "m/84'/0'/0'/0/1", source: 'hd', signerId: 's2' };

function mount({ shared = { lists: [] } } = {}) {
    listMetaSupported.mockResolvedValue(true);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OTHER_RECORD, OWNER_RECORD] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OTHER_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue({
            action_index: 2700, type: 2, source: OWNER, list_action_index: null,
            name: 'Old name', description: 'Old description', list: ['bc1qmember'],
            state: { owner: OWNER, edit_resolution_active: true, current_list: ['bc1qmember'] },
        }),
        getSharedLists: vi.fn().mockResolvedValue(shared),
        getActionFormats: vi.fn().mockResolvedValue({}),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListRenameForm walletId="wallet-1" listRef={{ chainId: CHAIN, actionIndex: '2700' }} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// From and Memo are closed standard sections; open one to reach its fields.
function openSection(title) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}\\b`), expanded: false }));
}

describe('ListRenameForm network, from and labels', () => {
    it('opens with Network then From, both ahead of every other field', async () => {
        mount();
        const from = await screen.findByLabelText('From');
        openSection('From');
        const network = screen.getByRole('button', { name: /^Network:/ });
        const name = screen.getByLabelText('Name');
        expect(from).toHaveValue(OWNER);
        expect(from).toHaveAttribute('readonly');
        expect(network.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(from.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByText('Signed from')).toBeNull();
        expect(document.querySelector('dl')?.textContent).not.toMatch(/Network|From/);
    });

    it('opens the address picker locked to the list chain and signs from the owner again', async () => {
        const messaging = mount();
        await screen.findByLabelText('From');
        openSection('From');
        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        const picker = screen.getByTestId('own-address-picker');
        expect(picker).toHaveAttribute('data-chain-id', CHAIN);
        expect(picker).toHaveAttribute('data-lock', 'true');
        expect(within(picker).getByRole('heading', { name: 'From Address' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Pick other' }));
        expect(await screen.findByLabelText('From')).toHaveValue(OTHER);
        expect(messaging.getListByActionIndex).toHaveBeenCalled();
    });

    it('shows the unchanged ownership blocker once a non-owner address is picked', async () => {
        mount();
        await screen.findByLabelText('From');
        expect(screen.queryByText(/is not an address in this wallet/)).toBeNull();
        openSection('From');
        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick other' }));
        await screen.findByLabelText('From');
        // Edit's owner blocker, which covers a rename as well as a member edit.
        // G99: the notice wraps, so the owner is named in full.
        expect(screen.getByText(`List #2700 is owned by ${OWNER}, which is not an address in this wallet. This wallet cannot edit it.`)).toBeTruthy();
    });

    it('labels Name and Description without a parenthetical and gives each a tip', async () => {
        mount();
        await screen.findByLabelText('Name');
        for (const label of ['Name', 'Description']) {
            const field = screen.getByLabelText(label);
            expect(field).toBeTruthy();
        }
        expect(document.body.textContent).not.toMatch(/empty means unchanged/);
        openSection('From');
        openSection('Details');
        openSection('Memo');
        expect(screen.getAllByRole('button', { name: /^About / }).length).toBeGreaterThanOrEqual(4);
        // The clear is the in-field X icon, shown once a field holds text.
        expect(screen.queryAllByRole('button', { name: /^Clear (Name|Description)$/ })).toHaveLength(0);
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
        fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'y' } });
        expect(screen.getAllByRole('button', { name: /^Clear (Name|Description)$/ })).toHaveLength(2);
        for (const clear of screen.getAllByRole('button', { name: /^Clear (Name|Description)$/ })) {
            expect(clear.querySelector('svg')).not.toBeNull();
        }
    });
});
