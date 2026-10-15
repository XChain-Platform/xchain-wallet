// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The page header holds only the screen title and Back. Dispensers,
// Messaging, Lists, Contacts, History, Addresses, Staking, My orders, My
// swaps, My tokens and Payments due used to put their create or refresh
// button in it, and the rename forms their Save; the action now sits in the
// ListPage actions row (or the form's own action row),
// the first item of the page content below any notice. When the list is
// empty and its EmptyState offers the same action, the row leaves it out,
// so the screen never shows the action twice.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/shared/hooks/useCoinpayObligations.js', () => ({
    useCoinpayObligations: () => ({ obligations: [], scanning: false, error: null, refresh: vi.fn() }),
}));
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';
import { MyTokens } from '../../../packages/core/src/shared/routes/MyTokens.jsx';
import { ObligationsView } from '../../../packages/core/src/shared/routes/ObligationsView.jsx';
import { RenameWalletForm } from '../../../packages/core/src/shared/routes/RenameWalletForm.jsx';
import { RenameAccountForm } from '../../../packages/core/src/shared/routes/RenameAccountForm.jsx';
import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';

const CHAIN = 'bitcoin-testnet';
const ADDRESS = 'tb1qpageheader00000000000000000000000000';
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

afterEach(() => cleanup());

function mount(Component, messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Component walletId="wallet-1" accountId="account-1" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

/** The page header row: the h1's title group's parent. */
function pageHeaderOf(title) {
    const heading = screen.getByRole('heading', { level: 1, name: title });
    return heading.parentElement.parentElement;
}

/** Buttons in the page header other than Back. */
function headerActions(title) {
    return within(pageHeaderOf(title)).queryAllByRole('button')
        .filter((button) => !/^Back/.test(button.getAttribute('aria-label') || ''));
}

function actionsRow() {
    return document.querySelector('[data-xc-page-actions]');
}

describe('ListPage actions row', () => {
    it('lays out notices, then actions, then the toolbar and the content', () => {
        render(
            <ListPage
                notices={<p>Notice</p>}
                actions={<button type="button">Create thing</button>}
                toolbar={<input aria-label="Search things" />}
            >
                <p>Content</p>
            </ListPage>,
        );
        const page = screen.getByText('Notice').parentElement;
        const order = [...page.children].map((child) => child.textContent || child.querySelector('input')?.getAttribute('aria-label'));
        expect(order).toEqual(['Notice', 'Create thing', 'Search things', 'Content']);
        expect(actionsRow()).toContainElement(screen.getByRole('button', { name: 'Create thing' }));
    });

    it('renders no actions row when there are no actions', () => {
        render(<ListPage><p>Content</p></ListPage>);
        expect(actionsRow()).toBeNull();
    });
});

describe('Contacts', () => {
    const contact = {
        schemaVersion: 1,
        id: 'c1',
        name: 'Alice',
        notes: '',
        entries: [{ chain: 'bitcoin', address: BTC, label: '' }],
        avatarSeed: BTC,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const messagingWith = (contacts) => ({
        listContacts: vi.fn(async () => contacts),
        saveContact: vi.fn(),
        deleteContact: vi.fn(),
    });

    it('puts Add contact in the actions row, not the page header', async () => {
        mount(ContactsList, messagingWith([contact]));
        await screen.findByRole('button', { name: 'Alice' });
        expect(headerActions('Contacts')).toEqual([]);
        const add = screen.getByRole('button', { name: 'Add contact' });
        expect(actionsRow()).toContainElement(add);
    });

    it('offers only the empty state action when there are no contacts', async () => {
        mount(ContactsList, messagingWith([]));
        await screen.findByText('No contacts yet');
        expect(screen.getByRole('button', { name: 'Create first contact' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
        expect(headerActions('Contacts')).toEqual([]);
    });

});

describe('My lists', () => {
    const messaging = (lists) => ({
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getListsForSource: vi.fn().mockResolvedValue({ data: lists }),
    });

    it('keeps Shared lists and Create union list in the actions row and offers Create list once when empty', async () => {
        mount(MyLists, messaging([]), {
            onOpenList: vi.fn(),
            onCreateList: vi.fn(),
            onOpenSharedLists: vi.fn(),
            onCreateUnionList: vi.fn(),
        });
        await screen.findByText('No lists yet');
        expect(screen.getAllByRole('button', { name: 'Create list' })).toHaveLength(1);
        expect(actionsRow()).not.toContainElement(screen.getByRole('button', { name: 'Create list' }));
        expect(actionsRow()).toContainElement(screen.getByRole('button', { name: 'Shared lists' }));
        expect(actionsRow()).toContainElement(screen.getByRole('button', { name: 'Create union list' }));
        expect(headerActions('My lists')).toEqual([]);
    });

    it('moves Create list into the actions row once there are lists', async () => {
        mount(MyLists, messaging([{ action_index: 7, type: '2', status: 'valid', source: ADDRESS }]), {
            onOpenList: vi.fn(),
            onCreateList: vi.fn(),
        });
        await screen.findByRole('button', { name: /Open .*7/ });
        const create = screen.getAllByRole('button', { name: 'Create list' });
        expect(create).toHaveLength(1);
        expect(actionsRow()).toContainElement(create[0]);
        expect(headerActions('My lists')).toEqual([]);
    });
});

describe('My dispensers', () => {
    it('puts Create dispenser in the actions row and offers it once on an empty list', async () => {
        const onCreateDispenser = vi.fn();
        mount(DispensersList, {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getDispensersForSource: vi.fn().mockResolvedValue([]),
        }, { activeAccountId: 'account-1', onCreateDispenser, onOpenDispenser: vi.fn() });
        await screen.findByText('No dispensers yet');
        const create = screen.getAllByRole('button', { name: 'Create dispenser' });
        expect(create).toHaveLength(1);
        expect(actionsRow()).toBeNull();
        expect(headerActions('My dispensers')).toEqual([]);
        fireEvent.click(create[0]);
        expect(onCreateDispenser).toHaveBeenCalledOnce();
    });
});

describe('Messaging', () => {
    it('keeps New conversation reachable above the unlock form', async () => {
        const onCompose = vi.fn();
        mount(MessagingInbox, {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'address-1', address: ADDRESS, source: 'hd', role: 'receive' }],
            }),
            listContacts: vi.fn().mockResolvedValue([]),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
        }, { activeAccountId: 'account-1', onCompose });
        await screen.findByRole('button', { name: 'Unlock inbox' });
        const compose = screen.getByRole('button', { name: 'New conversation' });
        expect(actionsRow()).toContainElement(compose);
        expect(headerActions('Messaging')).toEqual([]);
        fireEvent.click(compose);
        expect(onCompose).toHaveBeenCalledOnce();
    });

    it('offers New message from the empty inbox and no New conversation beside it', async () => {
        mount(MessagingInbox, {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'address-1', address: ADDRESS, source: 'hd', role: 'receive' }],
            }),
            listContacts: vi.fn().mockResolvedValue([]),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getMessagingInboxSweep: vi.fn().mockResolvedValue({ messages: [], addresses: [], errors: [] }),
        }, { activeAccountId: 'account-1', onCompose: vi.fn() });
        await screen.findByText('No messages yet');
        expect(screen.getByRole('button', { name: 'New message' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull();
        expect(headerActions('Messaging')).toEqual([]);
    });
});

describe('Addresses', () => {
    it('keeps the add and import menu in the actions row, not the page header', async () => {
        mount(AddressList, {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'address-1', address: ADDRESS, source: 'hd', role: 'receive' }],
            }),
        });
        const add = await screen.findByRole('button', { name: 'Add or import address' });
        expect(actionsRow()).toContainElement(add);
        expect(headerActions('Addresses')).toEqual([]);
        fireEvent.click(add);
        expect(screen.getByRole('menuitem', { name: 'Add address' })).toBeTruthy();
    });
});

describe('Staking', () => {
    const staking = (props = {}) => mount(StakingList, {
        getAddressesByChain: vi.fn().mockResolvedValue({}),
    }, { activeAccountId: 'account-1', onNewStake: props.onNewStake, onOpenStake: vi.fn() });

    it('keeps the page header bare on an empty list', async () => {
        const onNewStake = vi.fn();
        staking({ onNewStake });
        await screen.findByText('No staking address');
        expect(headerActions('Staking')).toEqual([]);
    });
});

describe('My orders and My swaps', () => {
    it('offers Create an order once on an empty list and keeps the page header bare', async () => {
        const onCreateOrder = vi.fn();
        mount(MyOrdersView, {
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getOrdersForAddress: vi.fn().mockResolvedValue([]),
        }, { onCreateOrder });
        await screen.findByText('No orders yet');
        expect(screen.getAllByRole('button', { name: /^(New order|Create an order)$/ })).toHaveLength(1);
        expect(actionsRow()).toBeNull();
        expect(headerActions('My orders')).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: 'Create an order' }));
        expect(onCreateOrder).toHaveBeenCalledOnce();
    });

    it('offers Create a swap once on an empty list and keeps the page header bare', async () => {
        mount(MySwapsView, {
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getSwapsForAddress: vi.fn().mockResolvedValue([]),
        }, { onCreateSwap: vi.fn() });
        await screen.findByText('No swaps yet');
        expect(screen.getAllByRole('button', { name: /^(New swap|Create a swap)$/ })).toHaveLength(1);
        expect(actionsRow()).toBeNull();
        expect(headerActions('My swaps')).toEqual([]);
    });
});

describe('My tokens', () => {
    it('puts Issue new token in the actions row once there are tokens', async () => {
        const onIssue = vi.fn();
        mount(MyTokens, {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getOwnedTokens: vi.fn().mockResolvedValue([
                { chainId: CHAIN, tick: 'DANKEST', description: 'Test token', locked: false },
            ]),
        }, { onIssue, onSelectTick: vi.fn() });
        const issue = await screen.findByRole('button', { name: 'Issue new token' });
        expect(actionsRow()).toContainElement(issue);
        expect(headerActions('My tokens')).toEqual([]);
        fireEvent.click(issue);
        expect(onIssue).toHaveBeenCalledOnce();
    });

    it('offers Issue token once on an empty list', async () => {
        mount(MyTokens, {
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getOwnedTokens: vi.fn().mockResolvedValue([]),
        }, { onIssue: vi.fn(), onSelectTick: vi.fn() });
        await screen.findByText('No owned tokens yet');
        expect(screen.queryByRole('button', { name: 'Issue new token' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Issue token' })).toHaveLength(1);
        expect(headerActions('My tokens')).toEqual([]);
    });
});

describe('Payments due', () => {
    it('puts Refresh payments in the actions row, not the page header', async () => {
        mount(ObligationsView, { getAutopayStatus: vi.fn().mockResolvedValue(null) }, { onPay: vi.fn() });
        const refresh = await screen.findByRole('button', { name: 'Refresh payments' });
        expect(actionsRow()).toContainElement(refresh);
        expect(headerActions('Payments due')).toEqual([]);
    });
});

describe('Rename forms', () => {
    const messaging = {
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Primary' }]),
        listAccounts: vi.fn().mockResolvedValue([]),
        renameWallet: vi.fn().mockResolvedValue({ wallet: { id: 'wallet-1', name: 'Spending' } }),
        renameAccount: vi.fn().mockResolvedValue({ account: { id: 'account-1', name: 'Spending' } }),
    };

    it('keeps Save out of the Rename wallet page header and submits from the form', async () => {
        const onRenamed = vi.fn();
        mount(RenameWalletForm, messaging, { initialName: 'Primary', onRenamed });
        const input = await screen.findByLabelText('Wallet name');
        expect(headerActions('Rename wallet')).toEqual([]);
        fireEvent.change(input, { target: { value: 'Spending' } });
        const save = screen.getByRole('button', { name: 'Save' });
        expect(save.closest('form')).toBeTruthy();
        fireEvent.click(save);
        await waitFor(() => expect(onRenamed).toHaveBeenCalled());
    });

    it('keeps Save out of the Rename account page header and submits from the form', async () => {
        const onRenamed = vi.fn();
        mount(RenameAccountForm, messaging, { initialName: 'Primary', onRenamed });
        const input = await screen.findByLabelText('Account name');
        expect(headerActions('Rename account')).toEqual([]);
        fireEvent.change(input, { target: { value: 'Spending' } });
        const save = screen.getByRole('button', { name: 'Save' });
        expect(save.closest('form')).toBeTruthy();
        fireEvent.click(save);
        await waitFor(() => expect(onRenamed).toHaveBeenCalled());
    });
});
