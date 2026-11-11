// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A form's main button names its action in every wallet mode: watcher mode
// only changes what the transaction becomes, never the word on the button.

import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useActionConfirmFlow: () => ({ open: false, composing: false, confirmAction: {}, run: vi.fn() }),
        useConfirmSubmit: () => vi.fn(),
    };
});

vi.mock('../../../packages/core/src/shared/hooks/useOwnerActionLane.js', () => ({
    useOwnerActionLane: () => ({
        open: false, composing: false, confirmProps: {}, run: vi.fn(), isWatcherMode: true,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { ListRenameForm } from '../../../packages/core/src/shared/routes/ListRenameForm.jsx';
import { ListShareForm } from '../../../packages/core/src/shared/routes/ListShareForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const ADDRESS = Object.freeze({
    id: 'owner-address', address: OWNER, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's',
});

function watcherMessaging() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'watcher' }),
        getActionFormats: vi.fn().mockResolvedValue({
            0: 'VERSION|TYPE|MEMO|...ITEM', 2: 'VERSION|LIST_ACTION_INDEX|MEMO', 5: 'VERSION|LIST_ACTION_INDEX|NAME|DESCRIPTION|MEMO',
        }),
        getListByActionIndex: vi.fn().mockResolvedValue({
            action_index: 2700, type: 2, status: 'valid', source: OWNER, list: [],
            state: { owner: OWNER, edit_resolution_active: true, current_list: [] },
        }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string' || property === 'then') return undefined;
            object[property] = vi.fn().mockResolvedValue(null);
            return object[property];
        },
    });
}

function mount(node) {
    render(<MessagingProvider shell="web" messaging={watcherMessaging()}>{node}</MessagingProvider>);
}

beforeEach(() => { __clearTokenInfoCache(); });
afterEach(() => { cleanup(); });

describe('watcher-mode main action labels', () => {
    // The screen slices name the watcher-mode action for what it makes, an
    // unsigned transaction for the offline signer, never a bare Review.
    it('ListCreateForm names Create unsigned transaction in watcher mode', async () => {
        mount(<ListCreateForm walletId="w" chainId={CHAIN} initialType="2" onBack={() => {}} />);
        await screen.findByLabelText('From');
        expect(screen.getByRole('button', { name: 'Create unsigned transaction' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    });

    it('ListRenameForm names Create unsigned transaction in watcher mode', async () => {
        mount(<ListRenameForm walletId="w" listRef={{ chainId: CHAIN, actionIndex: '2700' }} onBack={() => {}} />);
        expect(await screen.findByRole('button', { name: 'Create unsigned transaction' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
    });

    it('ListShareForm names Create unsigned transaction in watcher mode', async () => {
        mount(<ListShareForm walletId="w" listRef={{ chainId: CHAIN, actionIndex: '2700' }} onBack={() => {}} />);
        expect(await screen.findByRole('button', { name: 'Create unsigned transaction' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
    });
});

describe('watcher-mode hint and button source contract', () => {
    const dir = path.resolve(__dirname, '../../../packages/core/src/shared/routes');
    const read = (name) => fs.readFileSync(path.join(dir, name + '.jsx'), 'utf8');
    const WITH_HINT = [
        'AddressPreferencesForm', 'CrossChainSwapForm', 'DispenserForm', 'LinkForm',
        'ListCreateForm', 'ListForkForm', 'SellOwnershipForm', 'SwapForm',
    ];

    it.each(WITH_HINT)('%s shows the shared offline-signer hint and no bespoke paragraph', (name) => {
        const src = read(name);
        expect(src).toContain("t('common.watcherBuildsUnsigned')");
        expect(src).not.toMatch(/Watcher mode: this (wallet will build|builds)/);
    });

    it('GatedPublishForm and PublishFileForm name the offline signer in their own hint', () => {
        expect(read('GatedPublishForm')).toContain("t('gatedPublish.watcherHint')");
        expect(read('BatchComposerForm')).toContain("t('common.watcherBuildsUnsigned')");
        expect(read('PublishFileForm')).toMatch(/prepares the transaction for your offline signer/);
        expect(read('PublishFileForm')).not.toMatch(/Watcher mode: this (wallet will build|builds)/);
    });

    const LABELS = {
        AddressPreferencesForm: 'Update preferences',
        CreateBetFeedForm: 'Open market',
        CrossChainSwapForm: 'Create cross-chain swap',
        GatedPublishForm: "t('palette.createPublishFile.title')",
        ListCreateForm: 'Publish list',
        ListForkForm: 'Publish edit',
        ListRenameForm: 'Rename list',
        ListShareForm: 'Share list',
        ListTransferForm: 'Transfer list',
        PublishFileForm: 'Publish file',
        SellOwnershipForm: 'List name for sale',
        SwapForm: 'Create swap',
        UnionListForm: 'Create union list',
    };

    it.each(Object.entries(LABELS))('%s compose button reads %s outside watcher mode', (name, label) => {
        const src = read(name);
        expect(src).toContain(label);
        expect(src).not.toMatch(/singleEncode \? '[^']+' : '(Review|Preview)[^']*'/);
        expect(src).not.toMatch(/isWatcherMode \? '[^']+' : '(Review|Preview)[^']*'/);
    });
});
