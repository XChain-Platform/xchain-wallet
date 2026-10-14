// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';
import { ListRenameForm } from '../../../packages/core/src/shared/routes/ListRenameForm.jsx';
import { ListShareForm } from '../../../packages/core/src/shared/routes/ListShareForm.jsx';
import { ListTransferForm } from '../../../packages/core/src/shared/routes/ListTransferForm.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';

const CHAIN = 'dogecoin-mainnet';
const ADDRESS = {
    id: 'doge-0',
    address: 'DExampleExampleExampleExampleExample',
    publicKey: '02aa',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
};
const CURRENT_ITEMS = ['DOGESWAP', 'SWAPTEST'];
const CURRENT_ROW = {
    action_index: 2700,
    type: '1',
    source: ADDRESS.address,
    list: CURRENT_ITEMS,
    state: { edit_resolution_active: true, current_list: CURRENT_ITEMS },
};

function mountFork() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getListByActionIndex: vi.fn().mockResolvedValue(CURRENT_ROW),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
    };
    const messaging = new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });

    const view = render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(ListForkForm, {
            walletId: 'wallet-1',
            listRef: {
                chainId: CHAIN,
                actionIndex: '2700',
                type: '1',
                items: CURRENT_ITEMS,
                editResolutionActive: true,
                source: ADDRESS.address,
                parentIndex: null,
            },
            onBack() {},
            onDone() {},
        }),
    ));
    return { messaging, ...view };
}

function deferred() {
    let resolve;
    const promise = new Promise((onResolve) => { resolve = onResolve; });
    return { promise, resolve };
}

const BTC = 'bitcoin-mainnet';
const BTC_OWNER = {
    id: 'btc-owner',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const DESTINATION = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';

function existingListMessaging(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [BTC_OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: { id: BTC_OWNER.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getListByActionIndex: vi.fn(async ({ actionIndex }) => ({
            action_index: Number(actionIndex),
            type: '2',
            source: BTC_OWNER.address,
            list: [DESTINATION],
            state: { owner: BTC_OWNER.address, edit_resolution_active: true, current_list: [DESTINATION] },
        })),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
        getActionFormats: vi.fn().mockResolvedValue({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            2: 'VERSION|LIST_ACTION_INDEX|MEMO',
            3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
            4: 'VERSION|TYPE|NAME|DESCRIPTION|MEMO|...ITEM',
            5: 'VERSION|LIST_ACTION_INDEX|NAME|DESCRIPTION|MEMO',
        }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
        ...overrides,
    };
    return new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function renderExistingForm(Component, messaging, listRef) {
    const renderTree = (nextRef) => (
        <MessagingProvider shell="web" messaging={messaging}>
            <Component
                walletId="wallet-1"
                listRef={nextRef}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>
    );
    const view = render(renderTree(listRef));
    return {
        ...view,
        switchTo: (nextRef) => view.rerender(renderTree(nextRef)),
    };
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListForkForm first-leg submission', () => {
    it('starts one compose when two rapid clicks wait on the membership check', async () => {
        const { messaging } = mountFork();
        await screen.findByText(/Forking token list #2700/);
        fireEvent.change(screen.getByLabelText(/Add tokens/), { target: { value: 'NEWTICK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        const submit = await screen.findByRole('button', { name: 'Create unsigned transaction' });
        let releaseMembership;
        const membership = new Promise((resolve) => { releaseMembership = resolve; });
        messaging.getListByActionIndex.mockImplementation(() => membership);

        act(() => {
            submit.click();
            submit.click();
        });
        expect(submit).toBeDisabled();
        expect(submit).toHaveAttribute('aria-busy', 'true');
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();

        await act(async () => { releaseMembership(CURRENT_ROW); });
        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalledTimes(1));
    });
});

describe('list form submission locks', () => {
    it('builds one create transaction for two rapid watcher submits', async () => {
        const build = deferred();
        const messaging = existingListMessaging({
            buildActionPsbtRequest: vi.fn(() => build.promise),
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ListCreateForm walletId="wallet-1" chainId={BTC} initialType="1" onBack={() => {}} />
            </MessagingProvider>,
        );

        fireEvent.change(await screen.findByLabelText('Tokens (one per line)'), {
            target: { value: 'XCHAIN' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        const submit = await screen.findByRole('button', { name: 'Create unsigned transaction' });
        act(() => {
            submit.click();
            submit.click();
        });

        expect(messaging.buildActionPsbtRequest).toHaveBeenCalledTimes(1);
        await act(async () => build.resolve({ psbtHex: '70736274ff' }));
    });

    it('builds one owner action for two rapid watcher submits', async () => {
        const build = deferred();
        const messaging = existingListMessaging({
            buildActionPsbtRequest: vi.fn(() => build.promise),
        });
        renderExistingForm(ListTransferForm, messaging, {
            chainId: BTC,
            actionIndex: '2700',
            source: BTC_OWNER.address,
        });

        fireEvent.change(await screen.findByLabelText('Destination'), { target: { value: DESTINATION } });
        fireEvent.change(screen.getByLabelText('Type TRANSFER to confirm'), {
            target: { value: 'TRANSFER' },
        });
        const submit = screen.getByRole('button', { name: 'Create unsigned transaction' });
        act(() => {
            submit.click();
            submit.click();
        });

        expect(messaging.buildActionPsbtRequest).toHaveBeenCalledTimes(1);
        await act(async () => build.resolve({ psbtHex: '70736274ff' }));
    });
});

describe('existing list form identity', () => {
    it('resets fork membership edits when the list changes', async () => {
        const messaging = existingListMessaging();
        const first = {
            chainId: BTC,
            actionIndex: '2700',
            type: '1',
            items: ['KEEP'],
            editResolutionActive: true,
            source: BTC_OWNER.address,
            parentIndex: null,
        };
        const view = renderExistingForm(ListForkForm, messaging, first);
        const additions = await screen.findByLabelText(/Add tokens/);
        fireEvent.change(additions, { target: { value: 'STALE' } });

        view.switchTo({ ...first, actionIndex: '2800', items: ['FRESH'] });

        expect(await screen.findByText(/Forking token list #2800/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Add tokens/)).toHaveValue('');
    });

    it('resets rename fields when the list changes', async () => {
        const messaging = existingListMessaging();
        const view = renderExistingForm(ListRenameForm, messaging, {
            chainId: BTC,
            actionIndex: '2700',
        });
        fireEvent.change(await screen.findByLabelText('Name (empty means unchanged)'), {
            target: { value: 'STALE' },
        });

        view.switchTo({ chainId: BTC, actionIndex: '2800' });

        expect(await screen.findByText('#2800')).toBeInTheDocument();
        expect(screen.getByLabelText('Name (empty means unchanged)')).toHaveValue('');
    });

    it('resets share confirmation when the list changes', async () => {
        const messaging = existingListMessaging();
        const view = renderExistingForm(ListShareForm, messaging, {
            chainId: BTC,
            actionIndex: '2700',
        });
        fireEvent.change(await screen.findByLabelText('Memo (optional)'), {
            target: { value: 'STALE' },
        });
        fireEvent.change(screen.getByLabelText('Type SHARE to confirm'), {
            target: { value: 'SHARE' },
        });

        view.switchTo({ chainId: BTC, actionIndex: '2800' });

        expect(await screen.findByText('#2800')).toBeInTheDocument();
        expect(screen.getByLabelText('Memo (optional)')).toHaveValue('');
        expect(screen.getByLabelText('Type SHARE to confirm')).toHaveValue('');
    });

    it('resets transfer fields when the list changes', async () => {
        const messaging = existingListMessaging();
        const view = renderExistingForm(ListTransferForm, messaging, {
            chainId: BTC,
            actionIndex: '2700',
            source: BTC_OWNER.address,
        });
        fireEvent.change(await screen.findByLabelText('Destination'), {
            target: { value: DESTINATION },
        });
        fireEvent.change(screen.getByLabelText('Type TRANSFER to confirm'), {
            target: { value: 'TRANSFER' },
        });

        view.switchTo({
            chainId: BTC,
            actionIndex: '2800',
            source: BTC_OWNER.address,
        });

        expect(await screen.findByText('#2800')).toBeInTheDocument();
        expect(screen.getByLabelText('Destination')).toHaveValue('');
        expect(screen.getByLabelText('Type TRANSFER to confirm')).toHaveValue('');
    });

    it('ignores a transfer completion from the previous list', async () => {
        const build = deferred();
        const messaging = existingListMessaging({
            buildActionPsbtRequest: vi.fn(() => build.promise),
        });
        const view = renderExistingForm(ListTransferForm, messaging, {
            chainId: BTC,
            actionIndex: '2700',
            source: BTC_OWNER.address,
        });
        fireEvent.change(await screen.findByLabelText('Destination'), {
            target: { value: DESTINATION },
        });
        fireEvent.change(screen.getByLabelText('Type TRANSFER to confirm'), {
            target: { value: 'TRANSFER' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));
        expect(messaging.buildActionPsbtRequest).toHaveBeenCalledTimes(1);

        view.switchTo({
            chainId: BTC,
            actionIndex: '2800',
            source: BTC_OWNER.address,
        });
        expect(await screen.findByText('#2800')).toBeInTheDocument();
        await act(async () => build.resolve({ psbtHex: '70736274ff' }));

        expect(screen.getByText('#2800')).toBeInTheDocument();
        expect(screen.getByLabelText('Destination')).toHaveValue('');
        expect(screen.queryByLabelText('Unsigned transaction hex')).toBeNull();
    });
});

describe('list account identity', () => {
    it('ignores list rows returned for the previous account', async () => {
        const oldLists = deferred();
        const nextAddresses = deferred();
        const messaging = {
            getAddressesByChain: vi.fn((_walletId, accountId) => (
                accountId === 'account-1'
                    ? Promise.resolve({ [BTC]: [{ address: BTC_OWNER.address }] })
                    : nextAddresses.promise
            )),
            getListsForSource: vi.fn(() => oldLists.promise),
        };
        const renderTree = (activeAccountId) => (
            <MessagingProvider shell="web" messaging={messaging}>
                <MyLists
                    walletId="wallet-1"
                    activeAccountId={activeAccountId}
                    onOpenList={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>
        );
        const view = render(renderTree('account-1'));
        await waitFor(() => expect(messaging.getListsForSource).toHaveBeenCalledTimes(1));

        view.rerender(renderTree('account-2'));
        expect(screen.getByRole('status', { name: 'Loading lists' })).toBeInTheDocument();
        await act(async () => oldLists.resolve({
            data: [{ action_index: 2700, type: '2', status: 'valid', source: BTC_OWNER.address }],
        }));

        expect(screen.queryByRole('listitem')).toBeNull();
        expect(screen.getByRole('status', { name: 'Loading lists' })).toBeInTheDocument();
    });
});
