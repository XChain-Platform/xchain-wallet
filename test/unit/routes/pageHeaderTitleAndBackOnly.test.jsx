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
// swaps and Payments due used to put their create or refresh
// button in it, and the rename forms their Save; the action now sits in the
// ListPage actions row (or the form's own action row),
// the first item of the page content below any notice. When the list is
// empty and its EmptyState offers the same action, the row leaves it out,
// so the screen never shows the action twice. List pages have since moved
// to the approved title bar (G02, G04, G95): the filter icon, then the
// create plus at the far right, with nothing between the header and the list.

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

    // G95: the filter icon, then Add contact as a plain plus at the far right;
    // nothing sits between the header and the list.
    it('puts the filter, then the Add contact plus, in the title bar', async () => {
        mount(ContactsList, messagingWith([contact]));
        await screen.findByRole('button', { name: 'Alice' });
        const filter = screen.getByRole('button', { name: 'Filter contacts' });
        const add = screen.getByRole('button', { name: 'Add contact' });
        expect(headerActions('Contacts')).toEqual([filter, add]);
        expect(add.textContent.trim()).toBe('');
        expect(add.title).toBe('Add contact');
        expect(actionsRow()).toBeNull();
        expect(screen.queryByRole('searchbox', { name: 'Search contacts' })).toBeNull();
    });

    it('offers Add contact once, as the title bar plus, on an empty list', async () => {
        mount(ContactsList, messagingWith([]));
        await screen.findByText('No contacts yet');
        expect(screen.queryByRole('button', { name: 'Create first contact' })).toBeNull();
        const add = screen.getAllByRole('button', { name: 'Add contact' });
        expect(add).toHaveLength(1);
        expect(headerActions('Contacts')).toContain(add[0]);
        expect(actionsRow()).toBeNull();
    });

});

describe('My lists', () => {
    const messaging = (lists) => ({
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getListsForSource: vi.fn().mockResolvedValue({ data: lists }),
    });

    // Operator 2026-11-13: the filter, then Create list as the plus; no Shared
    // lists or Create union list button anywhere on the page.
    it('keeps the title bar to the filter and the Create list plus on an empty list', async () => {
        mount(MyLists, messaging([]), {
            onOpenList: vi.fn(),
            onCreateList: vi.fn(),
            onOpenSharedLists: vi.fn(),
            onCreateUnionList: vi.fn(),
        });
        await screen.findByText('No lists yet');
        expect(actionsRow()).toBeNull();
        const filter = screen.getByRole('button', { name: 'Filter lists' });
        const create = screen.getAllByRole('button', { name: 'Create list' });
        expect(create).toHaveLength(1);
        expect(headerActions('My Lists')).toEqual([filter, create[0]]);
        expect(screen.queryByRole('button', { name: 'Shared Lists' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create Union List' })).toBeNull();
    });

    it('keeps the search out of the page once there are lists', async () => {
        mount(MyLists, messaging([{ action_index: 7, type: '2', status: 'valid', source: ADDRESS }]), {
            onOpenList: vi.fn(),
            onCreateList: vi.fn(),
        });
        await screen.findByRole('button', { name: /Open .*7/ });
        const create = screen.getByRole('button', { name: 'Create list' });
        expect(actionsRow()).toBeNull();
        expect(headerActions('My Lists')).toEqual([screen.getByRole('button', { name: 'Filter lists' }), create]);
        expect(screen.queryByRole('searchbox', { name: 'Search lists' })).toBeNull();
    });
});

// The approved redesign (G02, G04) puts a list page's filter and its create plus in the title
// bar, and the empty state is text only, so the plus is offered exactly once.
describe('My dispensers', () => {
    it('puts the New dispenser plus in the title bar and offers it once on an empty list', async () => {
        const onCreateDispenser = vi.fn();
        mount(DispensersList, {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getDispensersForSource: vi.fn().mockResolvedValue([]),
        }, { activeAccountId: 'account-1', onCreateDispenser, onOpenDispenser: vi.fn() });
        await screen.findByText('No dispensers yet');
        const create = screen.getAllByRole('button', { name: 'New dispenser' });
        expect(create).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Create dispenser' })).toBeNull();
        expect(actionsRow()).toBeNull();
        expect(headerActions('Dispensers')).toContain(create[0]);
        fireEvent.click(create[0]);
        expect(onCreateDispenser).toHaveBeenCalledOnce();
    });
});

// The operator's Messaging header: the filter icon, then New message as a
// plain plus at the far right (Prediction markets' order); the search spans the
// toolbar row alone and the empty inbox is text only.
describe('Messaging', () => {
    const inboxMessaging = (overrides = {}) => ({
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'address-1', address: ADDRESS, source: 'hd', role: 'receive' }],
        }),
        listContacts: vi.fn().mockResolvedValue([]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getMessagingInboxSweep: vi.fn().mockResolvedValue({ messages: [], addresses: [], errors: [] }),
        ...overrides,
    });

    it('keeps the New message plus in the title bar above the unlock form', async () => {
        const onCompose = vi.fn();
        mount(MessagingInbox, inboxMessaging({
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
        }), { activeAccountId: 'account-1', onCompose });
        await screen.findByRole('button', { name: 'Unlock Inbox' });
        const compose = screen.getByRole('button', { name: 'New message' });
        expect(actionsRow()).toBeNull();
        expect(headerActions('Messaging')).toEqual([compose]);
        fireEvent.click(compose);
        expect(onCompose).toHaveBeenCalledOnce();
        expect(onCompose.mock.calls[0]).toEqual([]);
    });

    it('puts the filter icon, then the plus at the far right, in the title bar of the inbox', async () => {
        mount(MessagingInbox, inboxMessaging(), { activeAccountId: 'account-1', onCompose: vi.fn() });
        await screen.findByText('No messages yet');
        const compose = screen.getByRole('button', { name: 'New message' });
        const filter = screen.getByRole('button', { name: 'Filter conversations' });
        // Same order as Prediction markets: filter first, the plus rightmost.
        expect(headerActions('Messaging')).toEqual([filter, compose]);
        expect(compose.textContent.trim()).toBe('');
        expect(compose.title).toBe('New message');
        expect(filter.getAttribute('aria-haspopup')).toBe('dialog');
        expect(actionsRow()).toBeNull();
    });

    it('opens the compose route from the plus with no prefill', async () => {
        const onCompose = vi.fn();
        mount(MessagingInbox, inboxMessaging(), { activeAccountId: 'account-1', onCompose });
        await screen.findByText('No messages yet');
        fireEvent.click(screen.getByRole('button', { name: 'New message' }));
        expect(onCompose).toHaveBeenCalledOnce();
        expect(onCompose.mock.calls[0]).toEqual([]);
    });

    it('opens the network options from the filter icon', async () => {
        mount(MessagingInbox, inboxMessaging(), { activeAccountId: 'account-1', onCompose: vi.fn() });
        await screen.findByText('No messages yet');
        const filter = screen.getByRole('button', { name: 'Filter conversations' });
        expect(screen.queryByRole('dialog', { name: 'Filter conversations' })).toBeNull();
        fireEvent.click(filter);
        expect(filter.getAttribute('aria-expanded')).toBe('true');
        const panel = screen.getByRole('dialog', { name: 'Filter conversations' });
        expect(within(panel).getByRole('button', { name: /^Filter by network/ })).toBeTruthy();
    });

    it('narrows the conversations to the network picked in the filter panel', async () => {
        const btcPeer = 'tb1qbitcoinpeer0000000000000000000000000';
        const ltcPeer = 'tltc1qlitecoinpeer00000000000000000000000';
        mount(MessagingInbox, inboxMessaging({
            getMessagingInboxSweep: vi.fn().mockResolvedValue({
                messages: [
                    { from: btcPeer, to: ADDRESS, text: 'On Bitcoin', txid: 'tx-btc', timestamp: 2, chainId: CHAIN, format: 2, method: 1 },
                    { from: ltcPeer, to: ADDRESS, text: 'On Litecoin', txid: 'tx-ltc', timestamp: 1, chainId: 'litecoin-testnet', format: 2, method: 1 },
                ],
                addresses: [],
                errors: [],
            }),
        }), { activeAccountId: 'account-1', onCompose: vi.fn() });
        const list = await screen.findByRole('list', { name: 'Conversations' });
        expect(within(list).getAllByRole('button')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Filter conversations' }));
        const panel = screen.getByRole('dialog', { name: 'Filter conversations' });
        fireEvent.click(within(panel).getByRole('button', { name: /^Filter by network/ }));
        // The network filter opens the full-screen network list over the
        // panel; the pick reaches the filter and the panel stays open.
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Network' }))
            .getByRole('button', { name: 'Select Litecoin' }));
        await waitFor(() => {
            const rows = within(screen.getByRole('list', { name: 'Conversations' })).getAllByRole('button');
            expect(rows).toHaveLength(1);
            expect(rows[0].textContent).toContain('On Litecoin');
        });
        expect(screen.getByRole('button', { name: 'Filter conversations' }).getAttribute('data-active')).toBe('true');
    });

    it('puts the search in the filter panel, narrows the list, and keeps rows in one list card', async () => {
        mount(MessagingInbox, inboxMessaging({
            getMessagingInboxSweep: vi.fn().mockResolvedValue({
                messages: [
                    { from: 'tb1qalphapeer0000000000000000000000000', to: ADDRESS, text: 'hello alpha', txid: 'tx-a', timestamp: 2, chainId: CHAIN, format: 2, method: 1 },
                    { from: 'tb1qbetapeer00000000000000000000000000', to: ADDRESS, text: 'hello beta', txid: 'tx-b', timestamp: 1, chainId: CHAIN, format: 2, method: 1 },
                ],
                addresses: [],
                errors: [],
            }),
        }), { activeAccountId: 'account-1', onCompose: vi.fn() });
        const list = await screen.findByRole('list', { name: 'Conversations' });
        expect(list.className).toMatch(/convList/);
        expect(within(list).getAllByRole('button')).toHaveLength(2);
        expect(screen.queryByRole('searchbox', { name: 'Search conversations' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Filter conversations' }));
        const panel = screen.getByRole('dialog', { name: 'Filter conversations' });
        fireEvent.change(within(panel).getByRole('searchbox', { name: 'Search conversations' }), { target: { value: 'alphapeer' } });
        await waitFor(() => {
            expect(within(screen.getByRole('list', { name: 'Conversations' })).getAllByRole('button')).toHaveLength(1);
        });
        expect(screen.getByRole('button', { name: 'Filter conversations' }).getAttribute('data-active')).toBe('true');
    });

    it('leaves the empty inbox as text only with no search on the page', async () => {
        mount(MessagingInbox, inboxMessaging(), { activeAccountId: 'account-1', onCompose: vi.fn() });
        await screen.findByText('No messages yet');
        expect(screen.queryByRole('button', { name: 'New Message' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'New Conversation' })).toBeNull();
        expect(screen.getAllByRole('button', { name: /New message/i })).toHaveLength(1);
        expect(screen.queryByRole('searchbox', { name: 'Search conversations' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Filter by network/ })).toBeNull();
    });
});

describe('Addresses', () => {
    it('keeps the add and import menu as the plus in the title bar, with no actions row', async () => {
        mount(AddressList, {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'address-1', address: ADDRESS, source: 'hd', role: 'receive' }],
            }),
        });
        const add = await screen.findByRole('button', { name: 'Add or import address' });
        expect(actionsRow()).toBeNull();
        expect(headerActions('Addresses')).toContain(add);
        fireEvent.click(add);
        expect(screen.getByRole('menuitem', { name: 'Add Address' })).toBeTruthy();
    });
});

describe('Staking', () => {
    const staking = (props = {}) => mount(StakingList, {
        getAddressesByChain: vi.fn().mockResolvedValue({}),
    }, { activeAccountId: 'account-1', onNewStake: props.onNewStake, onOpenStake: vi.fn() });

    it('keeps the title bar to the filter and the New stake plus on an empty list', async () => {
        const onNewStake = vi.fn();
        staking({ onNewStake });
        await screen.findByText('No staking address');
        const names = headerActions('Staking').map((button) => button.getAttribute('aria-label'));
        expect(names).toHaveLength(2);
        expect(names[1]).toBe('New Stake');
        expect(actionsRow()).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'New Stake' }));
        expect(onNewStake).toHaveBeenCalledOnce();
    });
});

describe('My orders and My swaps', () => {
    it('offers New order once, as the title bar plus, on an empty list', async () => {
        const onCreateOrder = vi.fn();
        mount(MyOrdersView, {
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getOrdersForAddress: vi.fn().mockResolvedValue([]),
        }, { onCreateOrder });
        await screen.findByText('No orders yet');
        const create = screen.getAllByRole('button', { name: /^(New order|Create an order)$/ });
        expect(create).toHaveLength(1);
        expect(create[0].getAttribute('aria-label')).toBe('New order');
        expect(actionsRow()).toBeNull();
        expect(headerActions('My Orders')).toContain(create[0]);
        fireEvent.click(create[0]);
        expect(onCreateOrder).toHaveBeenCalledOnce();
    });

    it('offers New swap once, as the title bar plus, on an empty list', async () => {
        mount(MySwapsView, {
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getSwapsForAddress: vi.fn().mockResolvedValue([]),
        }, { onCreateSwap: vi.fn() });
        await screen.findByText('No swaps yet');
        const create = screen.getAllByRole('button', { name: /^(New swap|Create a swap)$/ });
        expect(create).toHaveLength(1);
        expect(create[0].getAttribute('aria-label')).toBe('New swap');
        expect(actionsRow()).toBeNull();
        expect(headerActions('My Swaps')).toContain(create[0]);
    });
});

describe('My tokens', () => {
    it('puts Create token in the page header once there are tokens', async () => {
        const onIssue = vi.fn();
        mount(MyTokens, {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getOwnedTokens: vi.fn().mockResolvedValue([
                { chainId: CHAIN, tick: 'DANKEST', description: 'Test token', locked: false },
            ]),
        }, { onIssue, onSelectTick: vi.fn() });
        const create = await screen.findByRole('button', { name: 'Create Token' });
        expect(actionsRow()).toBeNull();
        // The title bar holds the filter first and the Create token plus at the far right.
        expect(headerActions('My Tokens')).toHaveLength(2);
        expect(headerActions('My Tokens').at(-1)).toBe(create);
        expect(screen.queryByRole('button', { name: 'Issue new token' })).toBeNull();
        fireEvent.click(create);
        expect(onIssue).toHaveBeenCalledOnce();
    });

    it('offers Create token in both the header and empty state', async () => {
        mount(MyTokens, {
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getOwnedTokens: vi.fn().mockResolvedValue([]),
        }, { onIssue: vi.fn(), onSelectTick: vi.fn() });
        await screen.findByText('No owned tokens yet');
        expect(screen.queryByRole('button', { name: 'Issue new token' })).toBeNull();
        // The header icon button and the empty-state button share the Title Case name.
        expect(screen.getAllByRole('button', { name: 'Create Token' })).toHaveLength(2);
        expect(headerActions('My Tokens')).toHaveLength(2);
    });
});

describe('Payments due', () => {
    it('has no Refresh button and puts the filter icon in the page header', async () => {
        const onBack = vi.fn();
        mount(ObligationsView, { getAutopayStatus: vi.fn().mockResolvedValue(null) }, { onPay: vi.fn(), onBack });
        const filter = await screen.findByRole('button', { name: 'Filter payments due' });
        expect(screen.queryByRole('button', { name: 'Refresh Payments' })).toBeNull();
        expect(pageHeaderOf('Payments Due')).toContainElement(filter);
        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        expect(pageHeaderOf('Payments Due')).toContainElement(back);
        fireEvent.click(back);
        expect(onBack).toHaveBeenCalledOnce();
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
        expect(headerActions('Edit Wallet')).toEqual([]);
        fireEvent.change(input, { target: { value: 'Spending' } });
        const save = screen.getByRole('button', { name: 'Save Changes' });
        expect(save.closest('form')).toBeTruthy();
        fireEvent.click(save);
        await waitFor(() => expect(onRenamed).toHaveBeenCalled());
    });

    it('keeps Save out of the Rename account page header and submits from the form', async () => {
        const onRenamed = vi.fn();
        mount(RenameAccountForm, messaging, { initialName: 'Primary', onRenamed });
        const input = await screen.findByLabelText('Account name');
        expect(headerActions('Edit Account')).toEqual([]);
        fireEvent.change(input, { target: { value: 'Spending' } });
        const save = screen.getByRole('button', { name: 'Save Changes' });
        expect(save.closest('form')).toBeTruthy();
        fireEvent.click(save);
        await waitFor(() => expect(onRenamed).toHaveBeenCalled());
    });
});
