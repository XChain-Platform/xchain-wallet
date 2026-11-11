// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every non-signing state of the list edit screen lays out through the
// FormPage template: the load error is the template's body, the ownership
// warning leads the page as FormPage's notice, the loading line sits inside
// the template, and the watcher-mode refusal for an add-and-remove edit keeps
// its Back step in the template's action row. None of them draws straight into the bare Screen.
//
// Queries go through `container`: a failed role lookup on this large tree
// spends a long time building testing-library's role dump.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';

const CHAIN = 'dogecoin-mainnet';
const ADDRESS = {
    id: 'doge-0',
    address: 'DExampleExampleExampleExampleExample',
    publicKey: '02aa',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const OTHER_OWNER = 'DOtherOwnerOtherOwnerOtherOwnerOther';
const CURRENT_ITEMS = ['KEEP', 'REMOVE'];

function mountFork({ owner = ADDRESS.address, getAddressesByChain, walletMode = 'full' } = {}) {
    const row = {
        action_index: 2700,
        type: '1',
        source: owner,
        list: CURRENT_ITEMS,
        state: { edit_resolution_active: true, current_list: CURRENT_ITEMS, owner },
    };
    const target = {
        getAddressesByChain: getAddressesByChain || vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode, activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: walletMode === 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: walletMode === 'full' ? 'unlocked' : 'locked' }),
        getListByActionIndex: vi.fn().mockResolvedValue(row),
    };
    const messaging = new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListForkForm
                walletId="wallet-1"
                listRef={{
                    chainId: CHAIN,
                    actionIndex: '2700',
                    type: '1',
                    items: CURRENT_ITEMS,
                    editResolutionActive: true,
                    source: owner,
                    parentIndex: null,
                }}
                onBack={() => {}}
                onDone={() => {}}
            />
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
    expect(root).not.toBeNull();
    expect(screenBody(container).contains(root)).toBe(true);
    expect(root.parentElement === screenBody(container) || root.parentElement?.parentElement === screenBody(container)).toBe(true);
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

describe('ListForkForm lays out every non-signing state through FormPage', () => {
    it('shows the address-load error as its own box inside the FormPage template', async () => {
        const container = mountFork({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('store down')) });
        await waitFor(() => expect(container.textContent).toContain('Failed to load addresses.'));
        const error = byText(container, '[data-variant="error"]', 'Failed to load addresses.');
        formPageRoot(container, error);
        noBareChild(container, '[data-variant]');
    });

    it('puts the loading line inside the FormPage template', () => {
        const container = mountFork({ getAddressesByChain: () => new Promise(() => {}) });
        const loading = byText(container, 'p', 'Loading');
        formPageRoot(container, loading);
        noBareChild(container, 'p');
    });

    it('shows the ownership warning as the FormPage notice', async () => {
        const container = mountFork({ owner: OTHER_OWNER });
        await waitFor(() => expect(container.textContent).toContain('This wallet cannot edit it.'));
        const status = container.querySelector('[data-form-status]');
        expect(status).not.toBeNull();
        expect(status.textContent).toContain('is not an address in this wallet');
        formPageRoot(container, status);
        noBareChild(container, '[data-variant]');
    });

    it('keeps the watcher-mode add-and-remove refusal and its Back step inside the FormPage template', async () => {
        const container = mountFork({ walletMode: 'watcher' });
        fireEvent.change(await screen.findByLabelText('Add tokens'), { target: { value: 'ADD' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'REMOVE' }));
        fireEvent.click(screen.getByRole('button', { name: 'Publish edit' }));
        await waitFor(() => expect(container.textContent).toContain('Not available in watcher mode'));
        const title = byText(container, 'h2', 'Not available in watcher mode');
        const root = formPageRoot(container, title);
        const back = Array.from(root.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Back');
        expect(back).toBeTruthy();
        noBareChild(container, 'h2, p, [data-variant]');
        expect(back.closest('[role="group"]')).toBe(root);
    });
});
