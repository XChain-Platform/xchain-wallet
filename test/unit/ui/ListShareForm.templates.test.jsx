// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every state of the share-list screen lays out through a page template, the
// same as its form stage: the load error, the loading line, the queued result
// and the submitted result each sit inside ListPage, so the page edge and
// rhythm match the form on every shell. No call to the screen's wrap() hands
// Screen a bare child, and no ListPage nests inside another.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListShareForm } from '../../../packages/core/src/shared/routes/ListShareForm.jsx';
import listPageStyles from '../../../packages/core/src/ui/ListPage.module.css';

const SOURCE_PATH = 'packages/core/src/shared/routes/ListShareForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const ROOT_OWNER = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const OWNER_RECORD = Object.freeze({
    id: 'owner-address',
    address: OWNER,
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-owner',
});
const ROOT_OWNER_RECORD = Object.freeze({
    id: 'root-owner-address',
    address: ROOT_OWNER,
    publicKey: '02cc',
    derivationPath: "m/44'/0'/0'/0/2",
    source: 'hd',
    signerId: 'signer-root-owner',
});
const ACTIVE_RECORD = Object.freeze({
    id: 'active-address',
    address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
    publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/1",
    source: 'hd',
    signerId: 'signer-active',
});
const COMPOSED = Object.freeze({
    psbt: 'aa00',
    encoding: 'psbt',
    actionString: 'LIST|2|2700|worldwide',
    version: 1,
});

function baseDetail(overrides = {}) {
    return {
        action_index: 2700,
        type: 2,
        source: OWNER,
        list_action_index: null,
        list: ['bc1qmember'],
        state: { owner: OWNER, edit_resolution_active: true, current_list: ['bc1qmember'] },
        ...overrides,
    };
}

function makeMessaging({
    detail = baseDetail(), shared = { lists: [] }, addresses, listError = null,
    listActionIndex = '2700',
} = {}) {
    const rows = addresses || [ACTIVE_RECORD, OWNER_RECORD, ROOT_OWNER_RECORD];
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: rows }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn(async ({ actionIndex }) => {
            if (listError) throw listError;
            if (String(actionIndex) === String(listActionIndex)) return detail;
            if (String(actionIndex) === '2600') {
                return { action_index: 2600, type: 2, source: ROOT_OWNER, list_action_index: null };
            }
            return null;
        }),
        getSharedLists: vi.fn().mockResolvedValue(shared),
        getActionFormats: vi.fn().mockResolvedValue({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            2: 'VERSION|LIST_ACTION_INDEX|MEMO',
            3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
        }),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn().mockResolvedValue({ txid: 'share-txid' }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'bb00' }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount({
    support = { share: true, transfer: true, union: true },
    supportPending = false,
    created = { txid: 'share-txid' },
    ...messagingOptions
} = {}) {
    if (supportPending) listFormatSupport.mockReturnValue(new Promise(() => {}));
    else listFormatSupport.mockResolvedValue(support);
    const messaging = makeMessaging(messagingOptions);
    messaging.createList.mockResolvedValue(created);
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListShareForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex: '2700' }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
    return { messaging, ...view };
}

/** The closest ListPage container around a node, or null. */
function listPageOf(node) {
    return node.closest(`.${listPageStyles.page}`);
}

/** Confirms SHARE, reviews and approves through the confirm screen. */
async function share(messaging) {
    fireEvent.change(await screen.findByLabelText('Type SHARE to confirm'), { target: { value: 'SHARE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Share list' }));
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
    const approve = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(approve.disabled).toBe(false));
    fireEvent.click(approve);
    await waitFor(() => expect(messaging.createList).toHaveBeenCalledTimes(1));
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListShareForm lays out every page state through a template', () => {
    it('puts the load error inside ListPage', async () => {
        mount({ addresses: [] });
        const error = await screen.findByText('No address on this network yet. Use Receive to generate one first.');
        expect(listPageOf(error)).not.toBeNull();
    });

    it('puts the loading line inside ListPage', async () => {
        mount({ supportPending: true });
        const loading = await screen.findByText('Loading...');
        expect(listPageOf(loading)).not.toBeNull();
    });

    it('renders the queued result screen inside ListPage', async () => {
        const { messaging, container } = mount({ created: { queued: true, txid: 'queued-txid' } });
        await share(messaging);
        await waitFor(() => expect(container.querySelector('[data-testid="result-screen-notice"]')).not.toBeNull());
        const notice = container.querySelector('[data-testid="result-screen-notice"]');
        expect(listPageOf(notice)).not.toBeNull();
        expect(container.querySelectorAll(`.${listPageStyles.page}`)).toHaveLength(1);
    });

    it('puts the submitted result and Done inside one ListPage', async () => {
        const { messaging, container } = mount();
        await share(messaging);
        const title = await screen.findByText('List share submitted.');
        const page = listPageOf(title);
        expect(page).not.toBeNull();
        expect(page.querySelector('button')?.textContent).toBe('Done');
        expect(container.querySelectorAll(`.${listPageStyles.page}`)).toHaveLength(1);
    });

    it('hands wrap() only a template, never a bare child', () => {
        const source = readFileSync(join(process.cwd(), SOURCE_PATH), 'utf8');
        const start = source.indexOf('export function ListShareForm');
        const body = source.slice(start);
        const calls = [...body.matchAll(/\bwrap\(\s*<\s*([A-Za-z]*)/g)].map((match) => match[1]);
        expect(calls.length).toBeGreaterThan(0);
        const bare = calls.filter((tag) => tag !== 'ListPage' && tag !== 'FormPage');
        expect(bare).toEqual([]);
    });
});
