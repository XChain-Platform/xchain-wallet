// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Lists screens against list-edit resolution, and the list-form gaps
// found beside it on Dogecoin testnet.
//
//   RESOLUTION  - since LIST_EDIT_RESOLUTION_ACTIVATION a reference to a list
//                 resolves to its newest valid edit. ListDetail showed the
//                 as-created rows under "Current members" and the fork form
//                 said the original "never changes"; both now branch on the
//                 explorer's state.edit_resolution_active.
//   REPOINT     - the three repoint targets were hardcoded unbuilt although
//                 their edit screens exist; they now open through the shell.
//   MEMO        - LIST carries an optional MEMO on both versions; neither
//                 form offered one.
//   TICKS       - a token list only counted lines, so an unknown TICK the
//                 network leaves out was never reported.
//   CONFIRM     - two-step actions use Confirm Standard for each approval.
//   CHAIN       - Create list opened on the wallet's oldest chain.
//
// Each block mounts the real screen, since every defect was in what the
// screen rendered or sent, not in a helper.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import {
    ListEditRoute,
    ListForkRoute as ListForkForm,
    ListShareRoute as ListShareForm,
    ListTransferRoute as ListTransferForm,
} from '../../helpers/listFormRoutes.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { selectOption } from '../../helpers/selectOption.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { classifyTickItems, tickLookupVerdict } from '../../../packages/core/src/shared/utils/listTickItems.js';


const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';

const hd = (prefix, coinType) => ({
    id: `${prefix}-0`,
    address: `${prefix}1qindex0indexindexindexindexindexindex`,
    publicKey: '02a0',
    derivationPath: `m/84'/${coinType}'/0'/0/0`,
    source: 'hd',
    signerId: 'signer-1',
});

// Creation order: Bitcoin first. The old Create list default read this order.
const BY_CHAIN = Object.freeze({ [BTC]: [hd('bc', 0)], [DOGE]: [hd('doge', 3)] });

// `walletMode` among the overrides is the mode of wallet `w`, published the way
// the shell does from the wallet list; every other override is a messaging method.
function messagingWith({ walletMode = 'full', ...overrides } = {}) {
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ ...BY_CHAIN }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: { id: 'bc-0' }, [DOGE]: { id: 'doge-0' } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode }]),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
        getTokenInfo: vi.fn().mockResolvedValue(null),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (typeof prop !== 'string') return undefined;
            return () => Promise.resolve(null);
        },
        has: (t, prop) => prop in t,
    });
}

function mount(Component, props, messaging) {
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Component, props),
    ));
    return messaging;
}

afterEach(() => {
    cleanup();
    resetWalletModes();
    vi.useRealTimers();
    vi.clearAllMocks();
    __clearTokenInfoCache();
});

// LIST #2700 from the testnet repro: created SWAPTEST, MGRTEST (plus an
// unknown tick the network left out), then edited to DOGESWAP, SWAPTEST.
const LIST_2700 = {
    action_index: 2700, type: '1', status: 'valid', source: 'nsource', block_index: 10,
    list: ['MGRTEST', 'SWAPTEST'],
    edits: [
        { tick: 'SWAPTEST', status: 'valid' },
        { tick: 'MGRTEST', status: 'valid' },
        { tick: 'NOSUCHTICKQA', status: 'invalid: TICK (unknown)' },
    ],
};
const ACTIVE_STATE = { edit_resolution_active: true, membership_action_index: 2703, current_list: ['DOGESWAP', 'SWAPTEST'] };

function mountDetail(row, onFork = vi.fn()) {
    mount(ListDetail, { chainId: DOGE, actionIndex: '2700', onBack() {}, onFork },
        messagingWith({ getListByActionIndex: vi.fn().mockResolvedValue(row) }));
    return onFork;
}

// The detail page opens on Actions; members sit on the List tab and the
// facts on the Details tab.
async function openTab(name) {
    fireEvent.click(await screen.findByRole('tab', { name }));
}

describe('ListDetail membership under list-edit resolution', () => {
    it('lists state.current_list as the members and forks from it', async () => {
        const onFork = mountDetail({ ...LIST_2700, state: ACTIVE_STATE });
        await openTab('List');
        expect(await screen.findByText('DOGESWAP')).toBeTruthy();
        expect(screen.getByText('SWAPTEST')).toBeTruthy();
        expect(screen.queryByText('MGRTEST')).toBeNull();
        await openTab('Actions');
        fireEvent.click(screen.getByRole('button', { name: /^Fork\b/ }));
        expect(onFork).toHaveBeenCalledWith(expect.objectContaining({
            items: ['DOGESWAP', 'SWAPTEST'], editResolutionActive: true,
        }));
    });

    it('before activation lists the pinned rows as the members', async () => {
        const onFork = mountDetail({ ...LIST_2700, state: { edit_resolution_active: false, membership_action_index: 2700, current_list: null } });
        await openTab('List');
        expect(await screen.findByText('MGRTEST')).toBeTruthy();
        expect(screen.queryByText('DOGESWAP')).toBeNull();
        await openTab('Actions');
        fireEvent.click(screen.getByRole('button', { name: /^Fork\b/ }));
        expect(onFork).toHaveBeenCalledWith(expect.objectContaining({
            items: ['MGRTEST', 'SWAPTEST'], editResolutionActive: false,
        }));
    });

    it('an explorer without a state object forks with resolution unknown', async () => {
        const onFork = mountDetail({ ...LIST_2700 });
        fireEvent.click(await screen.findByRole('button', { name: /^Fork\b/ }));
        expect(onFork).toHaveBeenCalledWith(expect.objectContaining({ editResolutionActive: null }));
    });

    it('reports the items the network left out of a create', async () => {
        mountDetail({ ...LIST_2700, state: ACTIVE_STATE });
        await openTab('List');
        expect(await screen.findByText('Left out by the network (1)')).toBeTruthy();
        expect(screen.getByText('NOSUCHTICKQA')).toBeTruthy();
        const row = screen.getByText('NOSUCHTICKQA').closest('li');
        expect(row.textContent).toBe('NOSUCHTICKQA (token not found)');
        expect(row.getAttribute('title')).toBe('invalid: TICK (unknown)');
    });

    it('says why a fork edit item was left out in plain words', async () => {
        mountDetail({
            ...LIST_2700,
            action_index: 2703,
            list_action_index: 2700,
            edit: 1,
            edits: [{ tick: 'FORKADDED', status: 'valid' }, { address: 'notanaddress', status: 'invalid: ADDRESS (format)' }],
        });
        await openTab('List');
        const row = (await screen.findByText('notanaddress')).closest('li');
        expect(row.textContent).toBe('notanaddress (not a valid address for this network)');
        expect(screen.getByText('FORKADDED', { selector: 'code' }).closest('li').textContent).toBe('FORKADDED');
    });

    // The Details card's Status value carries the raw verdict as its tooltip.
    async function statusValue() {
        await openTab('Details');
        const row = (await screen.findByText('Status')).closest('li');
        return row.querySelector('span[class*="detailValue"]');
    }

    it('says why the network refused a list in its status row', async () => {
        mountDetail({ ...LIST_2700, status: 'invalid: LIST_ACTION_INDEX (not owner)' });
        const value = await statusValue();
        expect(value.textContent).toBe('Rejected: sent by an address that does not own the list');
        expect(value.getAttribute('title')).toBe('invalid: LIST_ACTION_INDEX (not owner)');
    });

    it('reads a valid list status as Valid with no tooltip', async () => {
        mountDetail({ ...LIST_2700 });
        const value = await statusValue();
        expect(value.textContent).toBe('Valid');
        expect(value.getAttribute('title')).toBeNull();
    });

    it('labels a numeric remove edit as removed items', async () => {
        mountDetail({
            ...LIST_2700,
            action_index: 2703,
            list_action_index: 2700,
            edit: 2,
            edits: [{ tick: 'MGRTEST', status: 'valid' }],
        });

        await openTab('Details');
        expect(await screen.findByText('#2700 (removed items)')).toBeTruthy();
    });

    it('shows a confirmed owner change and opens owner forms for a list owned outside the wallet', async () => {
        const owner = 'nexternalownerexternalownerexternal';
        const onFork = vi.fn();
        const onShare = vi.fn();
        const onTransfer = vi.fn();
        const onRename = vi.fn();
        mount(ListDetail, {
            walletId: 'w',
            chainId: DOGE,
            actionIndex: '2700',
            onBack() {},
            onFork,
            onShare,
            onTransfer,
            onRename,
        }, messagingWith({
            getListByActionIndex: vi.fn().mockResolvedValue({
                ...LIST_2700,
                state: { ...ACTIVE_STATE, owner },
            }),
            getActionFormats: vi.fn().mockResolvedValue({ 4: {}, 5: {} }),
        }));

        await screen.findByRole('button', { name: /^Edit(?! look)\b/ });
        expect(screen.queryByText('Only the owner can change this list.')).toBeNull();
        expect(screen.queryByText(/read-only/i)).toBeNull();
        expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
        for (const name of [/^Edit(?! look)\b/, /^Share\b/, /^Transfer\b/]) {
            const row = screen.getByRole('button', { name });
            expect(row).not.toHaveAttribute('aria-disabled');
        }
        fireEvent.click(screen.getByRole('button', { name: /^Edit(?! look)\b/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Share\b/ }));
        expect(onFork).toHaveBeenCalledTimes(1);
        expect(onShare).toHaveBeenCalledTimes(1);
        expect(onRename).not.toHaveBeenCalled();
        // Fork stays open on a list someone else owns.
        expect(screen.getByRole('button', { name: /^Fork\b/ })).not.toHaveAttribute('aria-disabled');
        await openTab('Details');
        expect(await screen.findByText('Current owner')).toBeTruthy();
    });
});

const forkRef = (editResolutionActive) => ({
    chainId: DOGE, actionIndex: '2700', type: '1', items: ['DOGESWAP', 'SWAPTEST'], editResolutionActive,
});
const WATCHER = { walletMode: 'watcher' };

function mountFork(editResolutionActive, overrides = {}, repointHandlers) {
    return mount(ListForkForm, {
        walletId: 'w', listRef: forkRef(editResolutionActive), onBack() {}, onDone() {}, repointHandlers,
    }, messagingWith(overrides));
}

// Watcher mode goes compose -> confirm -> build unsigned -> the repoint step
// without a signer, which is the shortest real path to that step.
async function approveConfirm(expectedSentence) {
    expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent(expectedSentence);
    expect(screen.getByTestId('confirm-reject')).toHaveAccessibleName('Reject');
    const approve = screen.getByTestId('confirm-approve');
    expect(approve).toHaveAccessibleName('Approve');
    fireEvent.click(approve);
}

async function forkToRepoint({ add = 'NEWTICK', memo = '' } = {}) {
    await screen.findByLabelText('Tokens');
    fireEvent.change(screen.getByLabelText('Tokens'), { target: { value: add } });
    if (memo) fireEvent.change(screen.getByLabelText(/Memo/, { selector: 'textarea' }), { target: { value: memo } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));
    await approveConfirm('Add 1 item to list #2700');
    await screen.findByText('Fork submitted');
}

describe('ListForkForm copy follows list-edit resolution', () => {
    it('under resolution says the edit becomes the list\'s current membership', async () => {
        mountFork(true);
        await screen.findByLabelText('Tokens');
        expect(screen.getByText(/becomes list #2700's current membership/)).toBeTruthy();
        expect(screen.queryByText(/never changes/)).toBeNull();
    });

    it('before activation keeps "#2700 itself never changes"', async () => {
        mountFork(false);
        await screen.findByLabelText('Tokens');
        expect(screen.getByText(/#2700 itself never changes/)).toBeTruthy();
    });

    it('with the flag unknown names both rules instead of asserting either', async () => {
        mountFork(null);
        await screen.findByLabelText('Tokens');
        expect(screen.getByText(/Where list-edit resolution is active/)).toBeTruthy();
        expect(screen.queryByText(/never changes/)).toBeNull();
    });

    it('under resolution omits the repoint rail and the "stays live" warning', async () => {
        mountFork(true, WATCHER);
        await forkToRepoint();
        expect(screen.queryByText('Repoint (optional)')).toBeNull();
        expect(screen.queryByText('Now referenced by')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Token allow/block lists' })).toBeNull();
        expect(screen.queryByText(/stays live everywhere/)).toBeNull();
        expect(screen.queryByText(/is unchanged and keeps working/)).toBeNull();
        expect(screen.getByText(/this edit is list #2700.s current/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    });

    it('before activation keeps the unchanged-original copy and the stays-live warning', async () => {
        mountFork(false, WATCHER);
        await forkToRepoint();
        expect(screen.getByText('Now referenced by')).toBeTruthy();
        expect(screen.getByText(/stays live everywhere it is referenced/)).toBeTruthy();
        expect(screen.getByText(/itself is unchanged/)).toBeTruthy();
    });
});

// Fork and edit signs from the owner when this wallet holds it and stays
// read-only when the owner is outside this wallet.
describe('ListForkForm signs from the list owner', () => {
    const OWNER = { ...hd('nowner', 3), id: 'doge-owner', address: 'nownerownerownerownerownerownerown' };
    const byChainWithOwner = { [BTC]: [hd('bc', 0)], [DOGE]: [hd('doge', 3), OWNER] };
    // #3069 is an edit of #2701; #2701 is the root create, made by OWNER.
    const rows = {
        2701: { action_index: 2701, type: '1', source: OWNER.address, list_action_index: null },
        3069: { action_index: 3069, type: '1', source: 'nsomeoneelsesomeoneelsesomeonee', list_action_index: 2701 },
    };
    const editRef = { chainId: DOGE, actionIndex: '3069', type: '1', items: ['SWAPTEST'], editResolutionActive: true,
        source: rows[3069].source, parentIndex: '2701' };
    const mountOwnerFork = (byChain) => mount(ListForkForm, { walletId: 'w', listRef: editRef, onBack() {}, onDone() {} },
        messagingWith({
            ...WATCHER,
            getAddressesByChain: vi.fn().mockResolvedValue(byChain),
            getListByActionIndex: vi.fn(({ actionIndex }) => Promise.resolve(rows[actionIndex] || null)),
        }));

    it('defaults FROM to the root creator when the wallet holds it, with no warning', async () => {
        const messaging = mountOwnerFork(byChainWithOwner);
        await screen.findByLabelText('Tokens');
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(OWNER.address));
        expect(screen.queryByText(/Signed from/)).toBeNull();
        expect(screen.queryByText(/which is not an address in this wallet/)).toBeNull();
        fireEvent.change(screen.getByLabelText('Tokens'), { target: { value: 'NEWTICK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));
        await approveConfirm('Add 1 item to list #3069');
        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalled());
        expect(messaging.buildActionPsbtRequest.mock.calls[0][0].from.address).toBe(OWNER.address);
    });

    // Edit stays owner-only; Fork of someone else's list forks it into a new
    // list owned by this wallet (LIST format 0 of the resulting members).
    it('refuses to edit when the wallet does not hold the list owner', async () => {
        mount(ListEditRoute, { walletId: 'w', listRef: editRef, onBack() {}, onDone() {} },
            messagingWith({
                ...WATCHER,
                getAddressesByChain: vi.fn().mockResolvedValue({ ...BY_CHAIN }),
                getListByActionIndex: vi.fn(({ actionIndex }) => Promise.resolve(rows[actionIndex] || null)),
            }));
        const warning = await screen.findByText(/not an address in this wallet/);
        expect(warning.textContent).toContain(OWNER.address.slice(0, 8));
        expect(warning.textContent).toMatch(/This wallet cannot edit it/);
        expect(screen.queryByRole('button', { name: 'Publish Fork' })).toBeNull();
        expect(screen.queryByLabelText('Tokens')).toBeNull();
    });

    it('forks a list the wallet does not own into a new list of its own', async () => {
        const messaging = mountOwnerFork({ ...BY_CHAIN });
        expect(await screen.findByLabelText('Tokens')).toBeTruthy();
        expect(screen.queryByText(/This wallet cannot edit it/)).toBeNull();
        fireEvent.change(screen.getByLabelText('Tokens'), { target: { value: 'NEWTICK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));
        await approveConfirm('Create token list of 2 items');
        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalled());
        expect(messaging.buildActionPsbtRequest.mock.calls[0][0].actionData.params).toEqual({
            VERSION: '0',
            TYPE: '1',
            ITEM: ['SWAPTEST', 'NEWTICK'],
        });
    });
});

describe('owner-only list actions', () => {
    const externalOwner = 'bc1qexternalownerexternalownerexternalowner';
    const listDetail = {
        action_index: 2700,
        type: 2,
        source: BY_CHAIN[BTC][0].address,
        list_action_index: null,
        list: ['bc1qmember'],
        state: { owner: externalOwner, edit_resolution_active: true, current_list: ['bc1qmember'] },
    };
    const formats = {
        0: 'VERSION|TYPE|MEMO|...ITEM',
        2: 'VERSION|LIST_ACTION_INDEX|MEMO',
        3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
    };

    function ownerActionMessaging() {
        return messagingWith({
            getListByActionIndex: vi.fn().mockResolvedValue(listDetail),
            getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
            getActionFormats: vi.fn().mockResolvedValue(formats),
        });
    }

    it('keeps direct share navigation inert for an external owner', async () => {
        const messaging = ownerActionMessaging();
        mount(ListShareForm, {
            walletId: 'w', listRef: { chainId: BTC, actionIndex: '2700' }, onBack() {},
        }, messaging);

        expect(await screen.findByText(/this wallet cannot share it/i)).toBeTruthy();
        const action = screen.getByRole('button', { name: 'Share List' });
        expect(action.disabled).toBe(false);
        fireEvent.click(action);
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Memo').disabled).toBe(true);
    });

    it('keeps direct transfer navigation inert for an external owner', async () => {
        const messaging = ownerActionMessaging();
        mount(ListTransferForm, {
            walletId: 'w', listRef: { chainId: BTC, actionIndex: '2700' }, onBack() {},
        }, messaging);

        expect(await screen.findByText(/this wallet cannot transfer it/i)).toBeTruthy();
        const action = screen.getByRole('button', { name: 'Transfer List' });
        expect(action.disabled).toBe(false);
        fireEvent.click(action);
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
        expect(screen.getByLabelText('New owner').disabled).toBe(true);
    });
});

// The fork form works from the members ListDetail read when it opened, but
// the network applies the edit to the list's newest valid edit at the time.
// An edit published in between (by anyone, while owner-only edits are not
// armed) was carried into the new version unseen, so the form re-reads first.
describe('ListForkForm refuses to build on members that changed since it loaded', () => {
    const rowWith = (current) => ({
        ...LIST_2700,
        state: { ...ACTIVE_STATE, current_list: current, owner: BY_CHAIN[DOGE][0].address },
    });

    it('stops at Review when the list gained a member the screen never showed', async () => {
        const messaging = mountFork(true, {
            ...WATCHER,
            getListByActionIndex: vi.fn().mockResolvedValue(rowWith(['DOGESWAP', 'INJECTED', 'SWAPTEST'])),
        });
        await screen.findByLabelText('Tokens');
        fireEvent.change(screen.getByLabelText('Tokens'), { target: { value: 'NEWTICK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));
        const error = await screen.findByText(/List #2700 changed since this screen loaded/);
        expect(error.textContent).toMatch(/now has 3 members, not 2/);
        expect(screen.queryByTestId('confirm-modal')).toBeNull();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('goes ahead when the re-read matches, in any order', async () => {
        const messaging = mountFork(true, {
            ...WATCHER,
            getListByActionIndex: vi.fn().mockResolvedValue(rowWith(['SWAPTEST', 'DOGESWAP'])),
        });
        await forkToRepoint();
        expect(messaging.buildActionPsbtRequest).toHaveBeenCalledTimes(1);
    });
});

// An airdrop to an existing list pays the list's newest valid edit, so the
// recipient count (and the total cost and Max built on it) must come from
// state.current_list, not from the members the list was created with.
describe('AirdropForm existing-list preview counts the members the airdrop will pay', () => {
    it('counts state.current_list, not the as-created rows', async () => {
        const row = {
            action_index: 2701, type: '2', status: 'valid', source: BY_CHAIN[BTC][0].address, block_index: 10,
            list: ['bc1qcreated0', 'bc1qcreated1'],
            state: { edit_resolution_active: true, membership_action_index: 3082,
                current_list: ['bc1qcreated0', 'bc1qcreated1', 'bc1qadded2', 'bc1qadded3', 'bc1qadded4'] },
        };
        mount(AirdropForm, { walletId: 'w', initialChainId: BTC, initialTick: 'JDOG', onBack() {} }, messagingWith({
            getListsForSource: vi.fn().mockResolvedValue([row]),
            getListByActionIndex: vi.fn().mockResolvedValue(row),
        }));
        selectOption(await screen.findByLabelText(/^Airdrop to/), 'existing');
        fireEvent.click(await screen.findByRole('button', { name: /^List:/ }));
        fireEvent.click(await screen.findByRole('button', { name: '5 addresses, address list, 5 addresses' }));
        expect(await screen.findByText('5 addresses on this list.')).toBeTruthy();
    });
});

describe('ListCreateForm edit copy follows list-edit resolution', () => {
    const copyFor = async (editResolutionActive) => {
        mount(ListCreateForm, { walletId: 'w', chainId: DOGE, initialType: '2', editResolutionActive, onBack() {} }, messagingWith());
        return (await screen.findByText(/permanent public on-chain data/)).textContent;
    };

    it('under resolution says an edit changes what every reference uses', async () => {
        const text = await copyFor(true);
        expect(text).toMatch(/everything that references this list then uses the edited membership/);
        expect(text).not.toMatch(/no way to edit/);
    });

    it('before activation keeps "no way to edit"', async () => {
        expect(await copyFor(false)).toMatch(/There's no way to edit or delete an address out of a list later/);
    });

    it('with the flag unknown names both rules', async () => {
        const text = await copyFor(undefined);
        expect(text).toMatch(/where list-edit resolution is active/);
        expect(text).not.toMatch(/no way to edit/);
    });
});

describe('ListForkForm repoint targets open their edit screens', () => {
    it('every target is enabled and calls the shell handler', async () => {
        const handlers = { 'issue-lists': vi.fn(), 'dispenser-lists': vi.fn(), 'order-lists': vi.fn() };
        mountFork(false, WATCHER, handlers);
        await forkToRepoint();
        for (const [label, id] of [
            ['Token allow/block lists', 'issue-lists'],
            ['Dispenser allow/block lists', 'dispenser-lists'],
            ['Order allow/block lists', 'order-lists'],
        ]) {
            const button = screen.getByRole('button', { name: label });
            expect(button.disabled).toBe(false);
            fireEvent.click(button);
            expect(handlers[id]).toHaveBeenCalledTimes(1);
        }
        expect(screen.queryByText(/coming soon/)).toBeNull();
    });

    it('a target the shell cannot route stays disabled rather than a dead link', async () => {
        mountFork(false, WATCHER, { 'issue-lists': vi.fn() });
        await forkToRepoint();
        expect(screen.getByRole('button', { name: 'Token allow/block lists' }).disabled).toBe(false);
        expect(screen.getByRole('button', { name: 'Order allow/block lists' }).disabled).toBe(true);
    });
});

describe('List forms send an optional MEMO', () => {
    it('ListForkForm puts the memo on the LIST v1 params', async () => {
        const messaging = mountFork(true, WATCHER);
        await forkToRepoint({ memo: 'Removed at their request' });
        const req = messaging.buildActionPsbtRequest.mock.calls[0][0];
        expect(req.actionData.params).toMatchObject({ VERSION: '1', MEMO: 'Removed at their request', ITEM: ['NEWTICK'] });
    });

    it('ListCreateForm puts the memo on the LIST v0 params and leaves it out when empty', async () => {
        const messaging = mount(ListCreateForm, { walletId: 'w', chainId: DOGE, initialType: '1', onBack() {} },
            messagingWith(WATCHER));
        fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'SWAPTEST' } });
        fireEvent.change(screen.getByLabelText(/Memo/, { selector: 'textarea' }), { target: { value: 'Our official tokens' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Unsigned Transaction' }));
        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent('Create token list of 1 item');
        expect(await screen.findByText('Our official tokens')).toBeTruthy();
        expect(screen.getByTestId('confirm-reject')).toHaveAccessibleName('Reject');
        fireEvent.click(screen.getByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalled());
        expect(messaging.buildActionPsbtRequest.mock.calls[0][0].actionData.params)
            .toMatchObject({ VERSION: '0', TYPE: '1', MEMO: 'Our official tokens', ITEM: ['SWAPTEST'] });
    });

    it('ListCreateForm refuses a memo with a protocol delimiter', async () => {
        mount(ListCreateForm, { walletId: 'w', chainId: DOGE, initialType: '1', onBack() {} }, messagingWith(WATCHER));
        fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'SWAPTEST' } });
        fireEvent.change(screen.getByLabelText(/Memo/, { selector: 'textarea' }), { target: { value: 'a|b' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Unsigned Transaction' }));
        expect(await screen.findByText(/Memo cannot contain \| or ;/)).toBeTruthy();
    });
});

describe('ListCreateForm checks token items before publishing', () => {
    const KNOWN = { creator: 'nowner', totalSupply: '100', canonicalTick: 'SWAPTEST' };
    const UNKNOWN = { creator: null, totalSupply: null, canonicalTick: null };

    it('counts valid, duplicate and malformed names, and flags a tick the network does not know', async () => {
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve(tick === 'SWAPTEST' ? KNOWN : UNKNOWN));
        mount(ListCreateForm, { walletId: 'w', chainId: DOGE, initialType: '1', onBack() {} }, messagingWith({ getTokenInfo }));
        const input = await screen.findByLabelText('Tokens');
        vi.useFakeTimers();
        fireEvent.change(input, {
            target: { value: 'SWAPTEST\nNOSUCHTICKQA\nswaptest\nBAD TICK' },
        });
        const counts = screen.getByText(/2 valid token names/);
        expect(counts.textContent).toMatch(/1 duplicate ignored/);
        expect(counts.textContent).toMatch(/1 invalid/);
        await act(async () => { await vi.advanceTimersByTimeAsync(349); });
        expect(getTokenInfo).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(counts.textContent).toMatch(/1 found · 1 not found/);
        expect(screen.getByRole('alert').textContent).toMatch(/Not found on the selected network: NOSUCHTICKQA/);
        expect(getTokenInfo).toHaveBeenCalledWith({ chainId: DOGE, tick: 'NOSUCHTICKQA', demo: false });
    });

    it('classifyTickItems and tickLookupVerdict keep the three verdicts apart', () => {
        expect(classifyTickItems('a, B\nb\n\nx y')).toEqual({ valid: ['a', 'B'], invalid: ['x y'], duplicates: 1 });
        expect(tickLookupVerdict(null)).toBe(null);
        expect(tickLookupVerdict(UNKNOWN)).toBe('missing');
        expect(tickLookupVerdict(KNOWN)).toBe('found');
    });

    it('classifies token-list items with the network ticker grammar', () => {
        expect(classifyTickItems('FLAM1N-H0T-CHEET0S, Wow!, c#, .A, A..B, A.')).toEqual({
            valid: ['FLAM1N-H0T-CHEET0S', 'Wow!', 'c#'],
            invalid: ['.A', 'A..B', 'A.'],
            duplicates: 0,
        });
        expect(classifyTickItems('A'.repeat(251)).invalid).toEqual(['A'.repeat(251)]);
    });
});

describe('two-step copy does not ask an unlocked wallet for a password', () => {
    // Fork shares Edit's one Add | Remove toggle over one Tokens field, so a
    // fork is never a two-transaction add plus remove from the form.
    it('ListForkForm carries one direction, never a two-transaction review', async () => {
        mountFork(true, { signerReady: vi.fn().mockResolvedValue({ ready: true }) });
        const field = await screen.findByLabelText('Tokens');
        fireEvent.change(field, { target: { value: 'NEWTICK' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Remove' }));
        expect(screen.getByLabelText('Tokens')).toHaveValue('');
        expect(screen.queryByLabelText('Add tokens')).toBeNull();
        expect(screen.queryByLabelText('Remove tokens')).toBeNull();
        fireEvent.change(screen.getByLabelText('Tokens'), { target: { value: 'DOGESWAP' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));
        expect(screen.queryByText(/two\s+transactions/)).toBeNull();
    });

    // The roster page edits the project's current list: removing OTHER
    // leaves SWAPTEST, which republishes the list and re-links it.
    const ROSTER = {
        roster_action_index: 60, total: 2, members: [{ tick: 'SWAPTEST' }, { tick: 'OTHER' }],
    };
    // The token list is a text box, one ticker per line (operator 2026-11-15):
    // removing OTHER is deleting its line.
    async function removeOtherAndSave() {
        const box = await screen.findByLabelText('Tokens');
        await waitFor(() => expect(box.value).toMatch(/OTHER/));
        fireEvent.change(box, { target: { value: box.value.split('\n').filter((line) => line.trim() !== 'OTHER').join('\n') } });
        fireEvent.click(screen.getByRole('button', { name: 'Update List' }));
    }

    it('ProjectRosterForm, unlocked', async () => {
        mount(ProjectRosterForm, { walletId: 'w', chainId: DOGE, tick: 'PROJ', issuerAddress: BY_CHAIN[DOGE][0].address, onBack() {} }, messagingWith({
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 77 }),
            getProjectForToken: vi.fn().mockResolvedValue(ROSTER),
        }));
        await removeOtherAndSave();
        const hint = await screen.findByText(/This is step 1 of 2/);
        await waitFor(() => expect(hint.textContent).not.toMatch(/wallet unlocked|no password is needed/i));
    });

    it('ProjectRosterForm confirms and preflights both legs before signing', async () => {
        const composeForConfirm = vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'LIST|0|1|SWAPTEST', version: '0',
            decoded: { summary: 'Create token list', details: [], warnings: [] },
        });
        const preflight = vi.fn().mockResolvedValue({ verdict: 'pass', findings: [], unverified: [] });
        const createList = vi.fn().mockResolvedValue({ txid: 'list-tx' });
        const linkAction = vi.fn().mockResolvedValue({ txid: 'link-tx' });
        const messaging = messagingWith({
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 77 }),
            composeForConfirm,
            preflight,
            createList,
            linkAction,
            getActionByTxid: vi.fn().mockResolvedValue({ action_index: 88 }),
            checkInputLiveness: vi.fn().mockResolvedValue({ live: true }),
            requoteNativeFee: vi.fn().mockResolvedValue(null),
            getProjectForToken: vi.fn().mockResolvedValue(ROSTER),
        });
        mount(ProjectRosterForm, { walletId: 'w', chainId: DOGE, tick: 'PROJ', issuerAddress: BY_CHAIN[DOGE][0].address, onBack() {} }, messaging);
        await removeOtherAndSave();
        fireEvent.click(await screen.findByRole('button', { name: 'Publish List' }));

        const from = (await screen.findByTestId('confirm-source')).textContent;
        expect(from).toContain(BY_CHAIN[DOGE][0].address.slice(0, 6));
        expect(from).toContain(BY_CHAIN[DOGE][0].address.slice(-6));
        expect(composeForConfirm.mock.calls[0][0].actionData).toEqual({
            action: 'LIST', params: { VERSION: '0', TYPE: '1', ITEM: ['SWAPTEST'] },
        });
        expect(preflight).toHaveBeenCalledOnce();
        expect(createList).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.getByTestId('confirm-approve')).toBeEnabled());
        fireEvent.click(screen.getByTestId('confirm-approve'));
        await waitFor(() => expect(createList).toHaveBeenCalledOnce());
        expect(createList.mock.calls[0][0].prebuiltPsbt.psbtHex).toBe('aa00');

        fireEvent.click(await screen.findByRole('button', { name: 'Make It Official' }));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(2));
        expect(composeForConfirm.mock.calls[1][0].actionData).toEqual({
            action: 'LINK',
            params: {
                VERSION: '0', COIN1: 'DOGE', COIN1_ACTION_INDEX: '88',
                COIN2: 'DOGE', COIN2_ACTION_INDEX: '77', MEMO: '',
            },
        });
        expect(preflight).toHaveBeenCalledTimes(2);
        expect(linkAction).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.getByTestId('confirm-approve')).toBeEnabled());
        fireEvent.click(screen.getByTestId('confirm-approve'));
        await waitFor(() => expect(linkAction).toHaveBeenCalledOnce());
        expect(linkAction.mock.calls[0][0].prebuiltPsbt.psbtHex).toBe('aa00');
    });

    // Drives the recipients path to the first Confirm Standard page.
    async function airdropListConfirm(ready) {
        mount(AirdropForm, { walletId: 'w', initialChainId: BTC, initialTick: 'JDOG', onBack() {} }, messagingWith({
            signerReady: vi.fn().mockResolvedValue({ ready }),
            getTokenInfo: vi.fn().mockResolvedValue({ chainId: BTC, tick: 'JDOG', divisibility: 8, locks: {} }),
        }));
        fireEvent.change(await screen.findByLabelText(/^Per-recipient amount/), { target: { value: '5' } });
        const box = document.querySelector('textarea');
        fireEvent.change(box, {
            target: { value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4\n1FWDonkMbC6hL64JiysuggHnUAw2CKWszs' },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Review Recipients' }));
        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent('Create address list of 2 items');
        expect(screen.getByTestId('confirm-reject')).toHaveAccessibleName('Reject');
        expect(screen.getByTestId('confirm-approve')).toHaveAccessibleName('Approve');
        return screen.findByTestId('confirm-summary-notice');
    }

    it('AirdropForm, unlocked, shows the first transaction on Confirm Standard', async () => {
        const notice = await airdropListConfirm(true);
        expect(notice).toHaveTextContent('This is the first of two transactions.');
        expect(screen.queryByText(/no password is needed/i)).toBeNull();
    });

    it('AirdropForm, locked, keeps password instructions off the action summary', async () => {
        await airdropListConfirm(false);
        expect(screen.queryByText(/enter your password twice/i)).toBeNull();
    });

    it('AirdropForm names both steps in plain words, not opcodes', async () => {
        const notice = await airdropListConfirm(false);
        expect(notice.textContent).toMatch(/After the address list confirms, you will approve the airdrop/);
        expect(notice.textContent).not.toMatch(/AIRDROP|indexed/);
    });
});

describe('ListCreateForm network default', () => {
    it('opens on the last-used network, not the first-created one', async () => {
        const messaging = mount(ListCreateForm, { walletId: 'w', onBack() {} }, messagingWith({
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet', lastUsedChain: { mainnet: DOGE } }),
        }));
        // Network sits in the closed From section, so it is read hidden.
        const button = await screen.findByRole('button', { name: /^Network: /, hidden: true });
        await waitFor(() => expect(button.getAttribute('aria-label') || button.textContent).toMatch(/^Network: Dogecoin/));
        expect(messaging.getSettings).toHaveBeenCalled();
    });

    it('falls back to the first network when nothing was used yet', async () => {
        mount(ListCreateForm, { walletId: 'w', onBack() {} }, messagingWith());
        const button = await screen.findByRole('button', { name: /^Network: /, hidden: true });
        expect(button.getAttribute('aria-label') || button.textContent).toMatch(/^Network: Bitcoin/);
    });
});
