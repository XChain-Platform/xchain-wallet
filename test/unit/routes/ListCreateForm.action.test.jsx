// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one List form: an Action field (Create, Edit, Share, Transfer, Fork)
// in the wallet's themed dropdown, first in the main section. Every list
// action button opens the form with its action picked, and switching the
// action keeps the fields every action shares (network, From, memo).

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const formatSupport = vi.hoisted(() => ({
    listFormatSupport: vi.fn(),
    listMetaSupported: vi.fn(),
}));

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => formatSupport);

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm, ListForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

const BTC = 'bitcoin-mainnet';
const OWNER = { id: 'owner-address', address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', publicKey: '02ab', source: 'hd', signerId: 's1' };
const OTHER = { id: 'other-address', address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', publicKey: '02ac', source: 'hd', signerId: 's2' };
const MEMBER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LIST_REF = { chainId: BTC, actionIndex: '2700' };

function mount(props = {}, detail = null) {
    formatSupport.listFormatSupport.mockResolvedValue({ share: true, transfer: true, union: true });
    formatSupport.listMetaSupported.mockResolvedValue(true);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [OTHER, OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: { id: OTHER.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue(detail || {
            action_index: 2700, type: 2, status: 'valid', source: OWNER.address, list_action_index: null,
            name: 'Team', description: 'Our team', list: [MEMBER],
            state: { owner: OWNER.address, edit_resolution_active: true, current_list: [MEMBER] },
        }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
        getActionFormats: vi.fn().mockResolvedValue({}),
        getListsForSource: vi.fn().mockResolvedValue({ data: [] }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            object[property] = stub;
            return stub;
        },
    });
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListCreateForm walletId="wallet-1" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    return { messaging, ...view };
}

async function actionTrigger(name = /^Action:/) {
    return screen.findByRole('button', { name });
}

async function chooseAction(label) {
    fireEvent.click(await actionTrigger());
    fireEvent.click(screen.getByRole('option', { name: label }));
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListCreateForm Action field', () => {
    it('is the themed dropdown with an icon per action, not a native select', async () => {
        // Opened with a list but no action, the form keeps the dropdown.
        const { container } = mount({ listRef: LIST_REF });
        const trigger = await actionTrigger('Action: Create');

        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        const field = container.querySelector('[data-list-action-field]');
        expect(field).not.toBeNull();
        expect(field.querySelector('select')).toBeNull();
        expect(container.querySelector('select')).toBeNull();
        expect(screen.queryByRole('combobox', { name: /Action/ })).toBeNull();
        // Its label is Action; the List type is Create's own field.
        expect(trigger.textContent).not.toMatch(/List type/);
        expect(screen.getByRole('button', { name: /^List type:/ })).toBeTruthy();

        fireEvent.click(trigger);
        const options = screen.getAllByRole('option');
        expect(options.map((option) => option.textContent)).toEqual(['Create', 'Edit', 'Share', 'Transfer', 'Fork']);
        for (const option of options) expect(option.querySelector('svg')).not.toBeNull();
    });

    it('opens on the action the route names, with that action\'s page and no Action dropdown', async () => {
        mount({ action: 'transfer', listRef: LIST_REF });
        expect(await screen.findByRole('heading', { name: 'Transfer List' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Action:/ })).toBeNull();
    });

    it.each([
        ['share', 'Share List'],
        ['transfer', 'Transfer List'],
        ['edit', 'Edit List'],
        ['fork', 'Fork List'],
    ])('fixes %s by how the user arrived: no Action dropdown', async (action, title) => {
        mount({ action, listRef: { ...LIST_REF, type: '2', items: [MEMBER] } });
        expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Action:/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'About Action' })).toBeNull();
    });

    it('opens the rename route on Edit, with the name and description', async () => {
        mount({ action: 'rename', listRef: LIST_REF });
        expect(await screen.findByLabelText('Name')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Action:/ })).toBeNull();
        expect(screen.getByLabelText('Name')).toBeTruthy();
        expect(screen.getByLabelText('Description')).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Remove' })).toBeTruthy();
        expect(screen.getByLabelText('Addresses')).toBeTruthy();
    });

    it('edits a union by its source list indexes', async () => {
        mount({ action: 'edit', listRef: LIST_REF }, {
            action_index: 2700, type: 3, status: 'valid', source: OWNER.address, list_action_index: null,
            name: 'Both', description: '', list: ['101'],
            state: { owner: OWNER.address, edit_resolution_active: true, current_list: ['101'] },
        });
        const add = await screen.findByLabelText('Source lists');
        expect(screen.getByRole('radio', { name: 'Remove' })).toBeTruthy();
        fireEvent.change(add, { target: { value: '102 abc' } });
        expect(await screen.findByText(/Invalid list indexes: abc/)).toBeTruthy();
    });

    it('edits a union from the reference List detail sends to onEdit', async () => {
        mount({
            action: 'edit',
            listRef: {
                chainId: BTC, actionIndex: '2700', type: '3', items: ['101', '102'],
                editResolutionActive: true, source: OWNER.address, parentIndex: null,
            },
        }, {
            action_index: 2700, type: 3, status: 'valid', source: OWNER.address, list_action_index: null,
            name: 'Both', description: '', list: ['101', '102'],
            state: { owner: OWNER.address, edit_resolution_active: true, current_list: ['101', '102'] },
        });
        expect(await screen.findByLabelText('Source lists')).toBeTruthy();
        expect(screen.queryByText(/current members?\b/)).toBeNull();
        expect(screen.queryByText(/Forking union list/)).toBeNull();
        expect(screen.getByRole('radio', { name: 'Add' })).toBeTruthy();
    });

    it('keeps network, From and memo across an action switch', async () => {
        mount({ listRef: LIST_REF });
        await chooseAction('Share');
        await actionTrigger('Action: Share');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'hello' } });
        expect(screen.getByLabelText('From')).toHaveValue(OWNER.address);

        await chooseAction('Transfer');
        expect(await actionTrigger('Action: Transfer')).toBeTruthy();
        expect(screen.getByLabelText('Memo')).toHaveValue('hello');
        expect(screen.getByLabelText('From')).toHaveValue(OWNER.address);
        expect(screen.getByRole('button', { name: /^Network:/, hidden: true })).toHaveAccessibleName(/Bitcoin/);
        // The switch remounts the body; the Action field takes focus back.
        await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Action: Transfer'));

        await chooseAction('Create');
        expect(await actionTrigger('Action: Create')).toBeTruthy();
        expect(await screen.findByRole('button', { name: /^List type:/ })).toBeTruthy();
        expect(screen.getByLabelText('Memo')).toHaveValue('hello');
        expect(screen.getByLabelText('From')).toHaveValue(OWNER.address);
        expect(screen.getByRole('button', { name: /^Network:/, hidden: true })).toHaveAccessibleName(/Bitcoin/);
    });

    it('offers the list actions only once a list is open', async () => {
        mount({ chainId: BTC });
        fireEvent.click(await actionTrigger('Action: Create'));
        for (const label of ['Edit', 'Share', 'Transfer', 'Fork']) {
            expect(screen.getByRole('option', { name: label })).toHaveAttribute('aria-disabled', 'true');
        }
        fireEvent.click(screen.getByRole('option', { name: 'Share' }));
        expect(screen.getByRole('heading', { name: 'Create List' })).toBeTruthy();
    });

    it('is exported as ListForm too', () => {
        expect(ListForm).toBe(ListCreateForm);
    });
});
