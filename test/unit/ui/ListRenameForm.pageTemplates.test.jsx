// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ListRenameForm's wrap() helper is a bare Screen. The load error, the
// loading line and the submitted result reach the page through a FormPage
// inside that Screen, like the form stage, so none of them draws straight
// into the Screen content box.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const listMetaSupported = vi.hoisted(() => vi.fn());
const laneRun = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listMetaSupported,
}));

// The owner lane is stubbed so the submitted result is reached without the
// confirm screen; the stub resolves the result the real lane hands back.
vi.mock('../../../packages/core/src/shared/hooks/useOwnerActionLane.js', () => ({
    useOwnerActionLane: () => ({
        open: false,
        composing: false,
        hw: false,
        isWatcherMode: false,
        confirmProps: {},
        run: laneRun,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { ListRenameForm } from '../../../packages/core/src/shared/routes/ListRenameForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const OWNER_RECORD = Object.freeze({
    id: 'owner-address',
    address: OWNER,
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-owner',
});
const TXID = 'ab'.repeat(32);

function makeMessaging(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER_RECORD] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue({
            action_index: 2700,
            type: 2,
            source: OWNER,
            name: 'Old name',
            description: 'Old description',
            list: [],
            state: { owner: OWNER, current_list: [] },
        }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
        ...overrides,
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(overrides = {}) {
    listMetaSupported.mockResolvedValue(true);
    return render(
        <MessagingProvider shell="web" messaging={makeMessaging(overrides)}>
            <ListRenameForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex: '2700' }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
}

// The FormPage root class, read from the component so the check follows the
// CSS-module naming the test run uses.
function formPageClass() {
    const probe = render(<FormPage as="div" label="probe"><p>x</p></FormPage>);
    const name = probe.container.querySelector('[aria-label="probe"]').className.split(' ')[0];
    probe.unmount();
    return name;
}

function renamePage(element, container) {
    const page = element.closest(`.${CSS.escape(formPageClass())}`);
    expect(page, 'inside FormPage').not.toBeNull();
    expect(page.getAttribute('aria-label')).toBe('Rename list');
    expect(page.parentElement, 'FormPage is not the Screen root').not.toBe(container);
    expect(container.contains(page)).toBe(true);
    return page;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListRenameForm: every stage renders inside FormPage', () => {
    it('keeps the Rename list page header', async () => {
        mount();
        expect(await screen.findByRole('heading', { name: 'Rename list' })).toBeTruthy();
    });

    it('lays out the load error as its own box inside FormPage', async () => {
        const { container } = mount({
            getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')),
        });
        const status = await screen.findByText('Address store unavailable');
        const box = status.closest('[data-variant="error"]');
        expect(box, 'its own error box').not.toBeNull();
        renamePage(box, container);
        expect(screen.getByRole('heading', { name: 'Rename list' })).toBeTruthy();
    });

    it('lays out the loading line inside FormPage', () => {
        const { container } = mount({ getAddressesByChain: vi.fn(() => new Promise(() => {})) });
        renamePage(screen.getByText('Loading...'), container);
    });

    it('lays out the submitted result inside FormPage with Done in the actions row', async () => {
        laneRun.mockResolvedValue({ txid: TXID });
        const { container } = mount();
        fireEvent.change(await screen.findByLabelText('Name'), {
            target: { value: 'Treasury' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Rename list' }));

        const notice = await screen.findByText('List rename submitted.');
        expect(laneRun).toHaveBeenCalledTimes(1);
        const page = renamePage(notice, container);
        expect(notice.closest('[data-form-status]'), 'success notice in the status region').not.toBeNull();

        const txid = within(page).getByText(TXID);
        expect(txid.closest('dl'), 'transaction id in the details list').not.toBeNull();
        expect(within(page).getByText(/new list details appear/)).toBeTruthy();

        const done = within(page).getByRole('button', { name: 'Done' });
        const actionsRow = done.parentElement;
        expect(actionsRow.parentElement, 'Done sits in the FormPage actions row').toBe(page);
        expect(actionsRow.lastElementChild).toBe(done);
        expect(screen.getByRole('heading', { name: 'Rename list' })).toBeTruthy();
    });
});
