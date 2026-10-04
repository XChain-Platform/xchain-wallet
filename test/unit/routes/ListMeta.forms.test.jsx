// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { confirmRun, confirmSubmit, ownerRun } = vi.hoisted(() => ({
    confirmRun: vi.fn(),
    confirmSubmit: vi.fn(),
    ownerRun: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useActionConfirmFlow: () => ({
            open: false,
            composing: false,
            confirmAction: {},
            run: confirmRun,
        }),
        useConfirmSubmit: () => confirmSubmit,
    };
});

vi.mock('../../../packages/core/src/shared/hooks/useOwnerActionLane.js', () => ({
    useOwnerActionLane: () => ({
        open: false,
        composing: false,
        confirmProps: {},
        run: ownerRun,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';
import { ListRenameForm } from '../../../packages/core/src/shared/routes/ListRenameForm.jsx';
import { ListShareForm } from '../../../packages/core/src/shared/routes/ListShareForm.jsx';
import { UnionListForm } from '../../../packages/core/src/shared/routes/UnionListForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const MEMBER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const ADDRESS = Object.freeze({
    id: 'owner-address',
    address: OWNER,
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-owner',
});
const META_FORMATS = Object.freeze({
    0: 'VERSION|TYPE|MEMO|...ITEM',
    1: 'VERSION|EDIT|LIST_ACTION_INDEX|MEMO|...ITEM',
    2: 'VERSION|LIST_ACTION_INDEX|MEMO',
    3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
    4: 'VERSION|TYPE|NAME|DESCRIPTION|MEMO|...ITEM',
    5: 'VERSION|LIST_ACTION_INDEX|NAME|DESCRIPTION|MEMO',
});

function detail(overrides = {}) {
    return {
        action_index: 2700,
        type: 2,
        status: 'valid',
        source: OWNER,
        list_action_index: null,
        list: [MEMBER],
        state: {
            owner: OWNER,
            edit_resolution_active: true,
            current_list: [MEMBER],
        },
        ...overrides,
    };
}

function makeMessaging(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
        getActionFormats: vi.fn().mockResolvedValue(META_FORMATS),
        getListByActionIndex: vi.fn().mockResolvedValue(detail()),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
        getListsForSource: vi.fn().mockResolvedValue({ data: [] }),
        ...overrides,
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            object[property] = stub;
            return stub;
        },
    });
}

function mount(component, messaging = makeMessaging()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            {component}
        </MessagingProvider>,
    );
    return messaging;
}

beforeEach(() => {
    __clearTokenInfoCache();
    confirmRun.mockReset();
    confirmRun.mockRejectedValue(new Error('stop after compose assertion'));
    confirmSubmit.mockReset();
    ownerRun.mockReset();
    ownerRun.mockResolvedValue({});
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('wallet list metadata forms', () => {
    it('creates format 4 metadata and counts UTF-8 bytes at both limits', async () => {
        const messaging = mount(
            <ListCreateForm walletId="wallet-1" chainId={CHAIN} initialType="2" onBack={() => {}} />,
        );

        await screen.findByLabelText('From');
        fireEvent.change(screen.getByLabelText('Addresses'), { target: { value: MEMBER } });
        fireEvent.change(await screen.findByLabelText('Name (optional)'), {
            target: { value: '🙂'.repeat(16) },
        });
        fireEvent.change(screen.getByLabelText('Description (optional)'), {
            target: { value: '🙂'.repeat(128) },
        });

        expect(screen.getByText('64 / 64 bytes')).toBeTruthy();
        expect(screen.getByText('512 / 512 bytes')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));

        await waitFor(() => expect(confirmRun).toHaveBeenCalledTimes(1));
        expect(confirmRun.mock.calls[0][0].actionData.params).toEqual({
            VERSION: '4',
            TYPE: '2',
            NAME: '🙂'.repeat(16),
            DESCRIPTION: '🙂'.repeat(128),
            ITEM: [MEMBER],
        });
        expect(messaging.getActionFormats).toHaveBeenCalledWith({ chainId: CHAIN, action: 'LIST' });
    });

    it('hides metadata inputs and preserves format 0 without metadata support', async () => {
        const messaging = makeMessaging({
            getActionFormats: vi.fn().mockResolvedValue({
                0: META_FORMATS[0],
                1: META_FORMATS[1],
                2: META_FORMATS[2],
                3: META_FORMATS[3],
            }),
        });
        mount(
            <ListCreateForm walletId="wallet-1" chainId={CHAIN} initialType="2" onBack={() => {}} />,
            messaging,
        );

        await screen.findByLabelText('From');
        await waitFor(() => expect(messaging.getActionFormats).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText('Addresses'), { target: { value: MEMBER } });
        expect(screen.queryByLabelText('Name (optional)')).toBeNull();
        expect(screen.queryByLabelText('Description (optional)')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));

        await waitFor(() => expect(confirmRun).toHaveBeenCalledTimes(1));
        expect(confirmRun.mock.calls[0][0].actionData.params).toEqual({
            VERSION: '0', TYPE: '2', ITEM: [MEMBER],
        });
    });

    it('shows list metadata and exposes Rename only when the callback and formats exist', async () => {
        const onRename = vi.fn();
        mount(
            <ListDetail
                chainId={CHAIN}
                actionIndex="2700"
                onBack={() => {}}
                onFork={() => {}}
                onRename={onRename}
            />,
            makeMessaging({
                getListByActionIndex: vi.fn().mockResolvedValue(detail({
                    name: 'Treasury',
                    description: 'Quarterly payout addresses',
                })),
            }),
        );

        expect(await screen.findByText('Treasury')).toBeTruthy();
        expect(screen.getByText('Quarterly payout addresses')).toBeTruthy();
        fireEvent.click(await screen.findByRole('button', { name: 'Rename list' }));
        expect(onRename).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '2700' });
    });

    it('keeps Rename hidden when metadata formats are unavailable', async () => {
        const messaging = makeMessaging({
            getActionFormats: vi.fn().mockResolvedValue({ 0: META_FORMATS[0] }),
        });
        mount(
            <ListDetail
                chainId={CHAIN}
                actionIndex="2700"
                onBack={() => {}}
                onFork={() => {}}
                onRename={() => {}}
            />,
            messaging,
        );

        await screen.findByText('#2700');
        await waitFor(() => expect(messaging.getActionFormats).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: 'Rename list' })).toBeNull();
    });

    it('submits the clear sentinel as format 5 and shows the shared-list fee note', async () => {
        mount(
            <ListRenameForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex: '2700' }}
                onBack={() => {}}
            />,
            makeMessaging({
                getListByActionIndex: vi.fn().mockResolvedValue(detail({
                    name: 'Old name',
                    description: 'Old description',
                })),
                getSharedLists: vi.fn().mockResolvedValue({
                    lists: [{ kind: 'home', home_chain: 'BTC', home_list_index: 2700 }],
                }),
            }),
        );

        await screen.findByLabelText('Name (empty means unchanged)');
        expect(screen.getByText(/shared-list edit fee/i)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear name' }));
        fireEvent.change(screen.getByLabelText('Description (empty means unchanged)'), {
            target: { value: 'New description' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await waitFor(() => expect(ownerRun).toHaveBeenCalledTimes(1));
        expect(ownerRun.mock.calls[0][0].actionData.params).toEqual({
            VERSION: '5',
            LIST_ACTION_INDEX: '2700',
            NAME: '-',
            DESCRIPTION: 'New description',
            MEMO: '',
        });
    });

    it('shows the current name in fork and share forms', async () => {
        const namedDetail = detail({ name: 'Treasury' });
        mount(
            <ListForkForm
                walletId="wallet-1"
                listRef={{
                    chainId: CHAIN,
                    actionIndex: '2700',
                    type: '2',
                    items: [MEMBER],
                    editResolutionActive: true,
                    source: OWNER,
                    parentIndex: null,
                }}
                onBack={() => {}}
            />,
            makeMessaging({
                getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
                getListByActionIndex: vi.fn().mockResolvedValue(namedDetail),
            }),
        );

        fireEvent.change(await screen.findByLabelText(/Add addresses/), {
            target: { value: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText('Treasury (List #2700)')).toBeTruthy();

        cleanup();
        mount(
            <ListShareForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex: '2700' }}
                onBack={() => {}}
            />,
            makeMessaging({ getListByActionIndex: vi.fn().mockResolvedValue(namedDetail) }),
        );
        expect(await screen.findByText('Treasury')).toBeTruthy();
    });

    it('shows current names for local and shared union candidates', async () => {
        mount(
            <UnionListForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} />,
            makeMessaging({
                getListsForSource: vi.fn().mockResolvedValue({
                    data: [{ action_index: 101, type: 1, members: [], name: 'Stable coins' }],
                }),
                getSharedLists: vi.fn().mockResolvedValue({
                    lists: [{
                        bindTarget: 900,
                        type: 2,
                        members: [],
                        home_chain: 'LTC',
                        home_list_index: 44,
                        name: 'Friends',
                    }],
                }),
            }),
        );

        expect(await screen.findByRole('checkbox', {
            name: 'Stable coins (Token list #101)',
        })).toBeTruthy();
        expect(screen.getByRole('checkbox', {
            name: 'Friends (Shared address list #900 from LTC list #44)',
        })).toBeTruthy();
    });
});
