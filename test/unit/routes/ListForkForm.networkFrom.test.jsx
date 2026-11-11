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

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';

const pickerProps = vi.hoisted(() => ({ last: null }));

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: (props) => {
        pickerProps.last = props;
        return (
            <div data-testid="own-address-picker">
                <h1>{props.title}</h1>
                <button type="button" onClick={() => props.onPick({ id: 'doge-1' })}>pick other</button>
                <button type="button" onClick={() => props.onPick({ id: 'doge-0' })}>pick owner</button>
            </div>
        );
    },
}));

const CHAIN = 'dogecoin-mainnet';
const OWNER = { id: 'doge-0', address: 'DOwnerOwnerOwnerOwnerOwnerOwner01', publicKey: '02aa', derivationPath: "m/44'/3'/0'/0/0", source: 'hd', signerId: 's1' };
const OTHER = { id: 'doge-1', address: 'DOtherOtherOtherOtherOtherOther002', publicKey: '02bb', derivationPath: "m/44'/3'/0'/0/1", source: 'hd', signerId: 's1' };
const MEMBERS = ['KEEP', 'REMOVE'];

function mountFork({ type = '1', items = MEMBERS } = {}) {
    const row = {
        action_index: 2700, type, source: OWNER.address, list: items,
        state: { edit_resolution_active: true, current_list: items, owner: OWNER.address },
    };
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER, OTHER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OTHER.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        getListByActionIndex: vi.fn().mockResolvedValue(row),
    };
    const messaging = new Proxy(target, {
        get(obj, prop) { return prop in obj ? obj[prop] : vi.fn().mockResolvedValue(null); },
    });
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListForkForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex: '2700', type, items, editResolutionActive: true, source: OWNER.address, parentIndex: null }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    pickerProps.last = null;
});

describe('ListForkForm network, from and field help', () => {
    it('opens with Network then From, From on the owner, and no Signed from line', async () => {
        const { container } = mountFork();
        const from = await screen.findByLabelText('From');
        await waitFor(() => expect(from).toHaveValue(OWNER.address));
        const network = screen.getByText('Network', { selector: 'label, span, div' });
        expect(network.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const form = container.querySelector('form');
        const fields = [...form.querySelectorAll('input, textarea, button')].map((el) => el.getAttribute('aria-label') || el.id || el.name || el.textContent);
        expect(fields.length).toBeGreaterThan(0);
        expect(screen.queryByText(/Signed from/)).toBeNull();
        expect(screen.queryByText(/uncheck to remove/i)).toBeNull();
        expect(screen.queryByText(/one per line/i, { selector: 'label, span' })).toBeNull();
    });

    it('opens the own-address picker locked to the list chain and signs from the picked owner', async () => {
        mountFork();
        const from = await screen.findByLabelText('From');
        await waitFor(() => expect(from).toHaveValue(OWNER.address));
        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        expect(await screen.findByTestId('own-address-picker')).toBeTruthy();
        expect(pickerProps.last.title).toBe('From address');
        expect(pickerProps.last.chainId).toBe(CHAIN);
        expect(pickerProps.last.lockNetwork).toBe(true);
        fireEvent.click(screen.getByText('pick owner'));
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(OWNER.address));
        expect(screen.queryByText(/which is not an address in this wallet/)).toBeNull();
    });

    it('shows the existing ownership blocker when another address is picked and refuses to publish', async () => {
        mountFork();
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(OWNER.address));
        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        fireEvent.click(await screen.findByText('pick other'));
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(OTHER.address));
        expect(await screen.findByText(/List #2700 is owned by DOwnerOw….*, which is not an address in this wallet\. This wallet cannot edit it\./)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Add tokens'), { target: { value: 'ADD' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish edit' }));
        expect(screen.getByText(/which is not an address in this wallet/)).toBeTruthy();
        expect(screen.queryByText('Review list edit')).toBeNull();
    });

    it('gives the add field and the current members a help tip, and the memo its own', async () => {
        mountFork({ type: '2', items: ['DOwnerOwnerOwnerOwnerOwnerOwner01'] });
        await screen.findByLabelText('Add addresses');
        expect(screen.getByRole('button', { name: 'About Add addresses' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About current members' })).toBeTruthy();
        expect(screen.getByText(/Enter one address per line\./)).toBeTruthy();
        expect(screen.getByText(/permanent public on-chain data/)).toBeTruthy();
        expect(screen.getByText(/Uncheck a member to remove it/)).toBeTruthy();
        expect(screen.getByText(/public note saved on the blockchain with this edit/)).toBeTruthy();
        expect(screen.queryByText(/same as creating a new list/, { selector: 'p' })).toBeNull();
    });

    it('draws the current members in one list card without inline styles', async () => {
        mountFork();
        const card = await screen.findByTestId('fork-current-members');
        expect(card.tagName).toBe('UL');
        expect(card.querySelectorAll('li')).toHaveLength(MEMBERS.length);
        expect(card.querySelectorAll('input[type="checkbox"]')).toHaveLength(MEMBERS.length);
        expect(card.getAttribute('style')).toBeNull();
        for (const li of card.querySelectorAll('li')) expect(li.getAttribute('style')).toBeNull();
        expect(screen.queryByText('Current members (uncheck to remove)')).toBeNull();
    });

    it('names the main action Publish edit, in green, with an icon', async () => {
        mountFork();
        const button = await screen.findByRole('button', { name: 'Publish edit' });
        expect(button.type).toBe('submit');
        expect(button.querySelector('svg')).toBeTruthy();
        expect(button.className).toMatch(/success/);
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    });
});
