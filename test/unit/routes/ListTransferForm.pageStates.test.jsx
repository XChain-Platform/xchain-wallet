// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every non-signing state of the list transfer screen lays out through the
// FormPage template the form itself uses: the list-load error is the
// template's body, the loading line sits inside the template, and the
// submitted panel keeps its Done step in the template's action row. None of
// them draws straight into the bare Screen.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListTransferForm } from '../../../packages/core/src/shared/routes/ListTransferForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const DESTINATION = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const OWNER_RECORD = Object.freeze({
    id: 'owner-address',
    address: OWNER,
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-owner',
});

function mountTransfer({ getAddressesByChain, getListByActionIndex } = {}) {
    listFormatSupport.mockResolvedValue({ share: true, transfer: true, union: true });
    const target = {
        getAddressesByChain: getAddressesByChain || vi.fn().mockResolvedValue({ [CHAIN]: [OWNER_RECORD] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: getListByActionIndex || vi.fn().mockResolvedValue({
            action_index: 2700,
            source: OWNER,
            state: { owner: OWNER },
        }),
        getActionFormats: vi.fn().mockResolvedValue({ 3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00',
            encoding: 'psbt',
            actionString: `LIST|3|2700|${DESTINATION}|`,
            version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn().mockResolvedValue({ txid: 'transfer-txid' }),
    };
    const messaging = new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListTransferForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex: '2700', source: OWNER }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
    return { container, messaging };
}

/** The Screen body: the element right after the page header. */
function screenBody(container) {
    const body = container.querySelector('header')?.nextElementSibling || null;
    expect(body).not.toBeNull();
    return body;
}

/** The FormPage root that holds `node`, asserting it sits in the Screen body. */
function formPageRoot(container, node) {
    expect(node).not.toBeNull();
    const root = node.closest('[role="group"], form');
    expect(root).not.toBeNull();
    const body = screenBody(container);
    expect(body.contains(root)).toBe(true);
    expect(root.parentElement === body || root.parentElement?.parentElement === body).toBe(true);
    return root;
}

/** No element of the given selector sits directly in the Screen body. */
function noBareChild(container, selector) {
    const direct = Array.from(screenBody(container).children).filter((el) => el.matches(selector));
    expect(direct).toEqual([]);
}

function byText(container, selector, text) {
    return Array.from(container.querySelectorAll(selector)).find((node) => node.textContent.includes(text)) || null;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListTransferForm lays out every non-signing state through FormPage', () => {
    it('shows a rejected list load as its own box inside the FormPage template', async () => {
        const { container } = mountTransfer({
            getListByActionIndex: vi.fn().mockRejectedValue(new Error('list store down')),
        });
        await waitFor(() => expect(container.textContent).toMatch(/list #2700/));
        const error = Array.from(container.querySelectorAll('[data-variant="error"]')).find((node) => /list #2700/.test(node.textContent)) || null;
        formPageRoot(container, error);
        noBareChild(container, '[data-variant], p');
    });

    it('puts the loading line inside the FormPage template while the list load is pending', () => {
        const { container } = mountTransfer({ getListByActionIndex: () => new Promise(() => {}) });
        const loading = byText(container, 'p', 'Loading');
        formPageRoot(container, loading);
        noBareChild(container, 'p');
    });

    it('keeps the submitted panel and its Done step inside the FormPage template', async () => {
        const { container, messaging } = mountTransfer();
        fireEvent.change(await screen.findByLabelText('Destination'), { target: { value: DESTINATION } });
        fireEvent.change(screen.getByLabelText('Type TRANSFER to confirm'), { target: { value: 'TRANSFER' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve.disabled).toBe(false));
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.createList).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(container.textContent).toContain('List transfer submitted.'));

        const txid = byText(container, 'code', 'transfer-txid');
        const root = formPageRoot(container, txid);
        const done = Array.from(root.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Done');
        expect(done).toBeTruthy();
        expect(byText(root, '[data-form-status]', 'List transfer submitted.')).not.toBeNull();
        noBareChild(container, 'p, dl, [data-variant]');
    });
});
