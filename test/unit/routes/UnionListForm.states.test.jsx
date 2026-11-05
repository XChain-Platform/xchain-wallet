// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is also available.

// Every non-signing state of the union list screen lays out through the
// FormPage template, like the form itself: the load error is the template's
// body, the loading line sits inside the template, and the
// submitted, queued and unsigned result panels sit inside it with their Done
// step. None of them draws straight into the bare Screen.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { UnionListForm } from '../../../packages/core/src/shared/routes/UnionListForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'source-address',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-source',
});

function makeMessaging(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListsForSource: vi.fn().mockResolvedValue({ data: [{ action_index: 101, type: 1, members: ['AAA'] }] }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [], unavailable: [] }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'LIST|0|3||101', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn().mockResolvedValue({ txid: 'union-txid' }),
        ...overrides,
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(overrides) {
    listFormatSupport.mockResolvedValue({ share: true, transfer: true, union: true });
    const { container } = render(
        <MessagingProvider shell="web" messaging={makeMessaging(overrides)}>
            <UnionListForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} onDone={() => {}} />
        </MessagingProvider>,
    );
    return container;
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
    expect(root, 'inside a FormPage').not.toBeNull();
    const body = screenBody(container);
    expect(body.contains(root)).toBe(true);
    expect(root.parentElement === body || root.parentElement?.parentElement === body).toBe(true);
    return root;
}

/** Only the FormPage (and its notice column) sits in the Screen body. */
function noBareChild(container, selector) {
    const direct = Array.from(screenBody(container).children).filter((el) => el.matches(selector));
    expect(direct.map((el) => el.outerHTML), 'no bare content in the Screen body').toEqual([]);
}

function byText(container, selector, text) {
    return Array.from(container.querySelectorAll(selector)).find((node) => node.textContent.includes(text)) || null;
}

async function submitUnion(container) {
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Token list #101' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const approve = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(approve.disabled).toBe(false));
    fireEvent.click(approve);
    return container;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('UnionListForm lays out every non-signing state through FormPage', () => {
    it('shows the address-load error as its own box inside the FormPage template', async () => {
        const container = mount({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        await waitFor(() => expect(container.textContent).toContain('Address store unavailable'));
        const error = byText(container, '[data-variant="error"]', 'Address store unavailable');
        formPageRoot(container, error);
        noBareChild(container, '[data-variant], p');
    });

    it('puts the loading line inside the FormPage template', () => {
        const container = mount({ getAddressesByChain: () => new Promise(() => {}) });
        const loading = byText(container, 'p', 'Loading');
        formPageRoot(container, loading);
        noBareChild(container, '[data-variant], p');
    });

    it('keeps the submitted panel and its Done step inside the FormPage template', async () => {
        const container = await submitUnion(mount());
        await waitFor(() => expect(container.textContent).toContain('Union list submitted.'));
        const root = formPageRoot(container, byText(container, '[data-variant]', 'Union list submitted.'));
        const done = Array.from(root.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Done');
        expect(done).toBeTruthy();
        expect(done.closest('[role="group"], form')).toBe(root);
        noBareChild(container, '[data-variant], p');
    });

    it('keeps the queued result panel inside the FormPage template', async () => {
        const container = await submitUnion(mount({
            createList: vi.fn().mockResolvedValue({ queued: true }),
        }));
        const done = await screen.findByRole('button', { name: 'Done' });
        formPageRoot(container, done);
    });
});
