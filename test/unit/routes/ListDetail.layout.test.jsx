// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The approved list detail (Layout 1, walk 2026-11-13): an identity card with
// the list's own look, then Actions (default), List and Details tabs.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qdevmockowneraddress000000000000d77a1f';
const OTHER = 'bc1qr7hzp2otherowneraddress00000000k2p9ad';
const MEMBERS = [
    'bc1qdevmockmemberaddress0000000000000d77a1f',
    'bc1q9x2k4tmemberaddress00000000000000m4t7ur',
    'bc1qw5083amemberaddress00000000000000v8f3t4',
];
const PARTNERS = ['bc1qr7hzp2partneraddress000000000000k2p9ad', 'bc1qm8vc5epartneraddress000000000000q0x3lw'];

const OWN_LIST = {
    type: '2', status: 'valid', source: OWNER, block_index: 908124, name: 'Team payouts', list: MEMBERS,
};
const UNION_LIST = {
    type: '3', status: 'valid', source: OWNER, block_index: 908300, name: 'Combined allow list', list: ['908124001', '907455210'],
};
const SOURCES = {
    908124001: { ...OWN_LIST },
    907455210: { type: '2', status: 'valid', source: OTHER, name: 'Partners', list: PARTNERS },
};

function mountDetail({ row = OWN_LIST, walletAddress = OWNER, handlers = {}, actionIndex = '77' } = {}) {
    const messaging = {
        getListByActionIndex: vi.fn(({ actionIndex: index }) => Promise.resolve(
            index === actionIndex ? row : (SOURCES[index] || null),
        )),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: walletAddress }] }),
        getActionFormats: vi.fn().mockResolvedValue({}),
    };
    const props = {
        walletId: 'wallet-1',
        chainId: CHAIN,
        actionIndex,
        onBack: () => {},
        onFork: handlers.onFork || vi.fn(),
        onShare: handlers.onShare || vi.fn(),
        onTransfer: handlers.onTransfer || vi.fn(),
        ...(handlers.onEdit ? { onEdit: handlers.onEdit } : {}),
    };
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListDetail {...props} />
        </MessagingProvider>,
    );
    return { ...view, messaging, props };
}

async function openTab(name) {
    fireEvent.click(await screen.findByRole('tab', { name }));
}

// The Actions tab is the shared action list (G101): one row per action, found
// by its action id. Ownership is checked only after a row opens its form.
const ACTION_IDS = ['edit', 'share', 'transfer', 'fork', 'look'];

function actionRow(id) {
    const row = screen.getByRole('list', { name: 'List actions' }).querySelector(`[data-action-id="${id}"]`);
    if (!row) throw new Error(`no "${id}" row in the List actions list`);
    return row;
}

const isLocked = (row) => row.getAttribute('aria-disabled') === 'true';

beforeEach(() => { try { localStorage.clear(); } catch { /* no storage */ } });
afterEach(cleanup);

describe('ListDetail tabs', () => {
    it('shows Actions, List and Details tabs with Actions chosen first', async () => {
        mountDetail();
        await screen.findByRole('heading', { name: 'Team payouts' });
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'List', 'Details']);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        for (const tab of tabs) expect(tab.querySelector('svg')).toBeTruthy();
        expect(screen.queryByText('Members')).toBeNull();
    });
});

describe('ListDetail action tiles', () => {
    it('offers Edit, Share, Transfer, Fork and Edit Look to the owner, none locked', async () => {
        const onEdit = vi.fn();
        const onShare = vi.fn();
        const onTransfer = vi.fn();
        const onFork = vi.fn();
        mountDetail({ handlers: { onEdit, onShare, onTransfer, onFork } });
        await waitFor(() => expect(isLocked(actionRow('edit'))).toBe(false));
        const list = screen.getByRole('list', { name: 'List actions' });
        const rows = [...list.querySelectorAll('[data-action-id]')];
        expect(rows.map((row) => row.getAttribute('data-action-id'))).toEqual(ACTION_IDS);
        // Sentence-case titles (G101), each with its one-line description.
        ['Edit', 'Share', 'Transfer', 'Fork', 'Edit look'].forEach((title, i) => {
            expect(rows[i].textContent.startsWith(title)).toBe(true);
            expect(rows[i].textContent.length).toBeGreaterThan(title.length);
        });
        for (const row of rows) {
            expect(isLocked(row)).toBe(false);
            expect(row.querySelector('svg')).toBeTruthy();
        }
        expect(screen.queryByText(/Only the owner/)).toBeNull();

        fireEvent.click(actionRow('edit'));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN, actionIndex: '77', type: '2', items: MEMBERS, source: OWNER, parentIndex: null,
        }));
        fireEvent.click(actionRow('share'));
        expect(onShare).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '77' });
        fireEvent.click(actionRow('transfer'));
        expect(onTransfer).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '77' });
        fireEvent.click(actionRow('fork'));
        expect(onFork).toHaveBeenCalledWith(expect.objectContaining({ actionIndex: '77', items: MEMBERS }));
    });

    it('sends Edit to the fork handler when the shell passes no edit handler', async () => {
        const onFork = vi.fn();
        mountDetail({ handlers: { onFork } });
        await waitFor(() => expect(isLocked(actionRow('edit'))).toBe(false));
        fireEvent.click(actionRow('edit'));
        expect(onFork).toHaveBeenCalledWith(expect.objectContaining({ actionIndex: '77', items: MEMBERS }));
    });

    it('keeps owner rows enabled for a list another address owns', async () => {
        const onEdit = vi.fn();
        const onShare = vi.fn();
        const onTransfer = vi.fn();
        const onFork = vi.fn();
        const { container, messaging } = mountDetail({ walletAddress: OTHER, handlers: { onEdit, onShare, onTransfer, onFork } });
        await screen.findByRole('button', { name: /^Edit(?! look)\b/ });
        for (const id of ['edit', 'share', 'transfer']) {
            const row = actionRow(id);
            expect(isLocked(row)).toBe(false);
        }
        expect(isLocked(actionRow('fork'))).toBe(false);
        expect(isLocked(actionRow('look'))).toBe(false);
        fireEvent.click(actionRow('edit'));
        expect(onEdit).toHaveBeenCalledTimes(1);
        fireEvent.click(actionRow('share'));
        fireEvent.click(actionRow('transfer'));
        expect(onShare).toHaveBeenCalledTimes(1);
        expect(onTransfer).toHaveBeenCalledTimes(1);
        fireEvent.click(actionRow('fork'));
        expect(onFork).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-variant="warning"]')).toBeNull();
        expect(screen.queryByText(/read-only/i)).toBeNull();
        expect(screen.queryByText('Only the owner can change this list.')).toBeNull();
        expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
    });

    it('omits owner actions the shell does not pass', async () => {
        const messaging = {
            getListByActionIndex: vi.fn().mockResolvedValue(OWN_LIST),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OTHER }] }),
        };
        render(
            <MessagingProvider
                shell="web"
                messaging={messaging}
            >
                <ListDetail walletId="wallet-1" chainId={CHAIN} actionIndex="77" onBack={() => {}} onFork={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByRole('button', { name: /^Edit(?! look)\b/ });
        expect(document.querySelector('[data-action-id="share"]')).toBeNull();
        expect(document.querySelector('[data-action-id="transfer"]')).toBeNull();
        expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
    });
});

describe('ListDetail look', () => {
    it('draws the initials, the network badge, and opens the look editor from the icon and the tile', async () => {
        const { container } = mountDetail();
        await screen.findByRole('heading', { name: 'Team payouts' });
        const icon = screen.getByRole('button', { name: 'Edit look' });
        expect(icon.querySelector('[data-xc-avatar]').textContent).toBe('TP');
        expect(icon.querySelector('img')).toBeTruthy();

        fireEvent.click(icon);
        // Edit look is its own page (no modal) with the same look fields.
        expect(await screen.findByRole('heading', { name: 'Edit Look' })).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByText('Icon colour')).toBeTruthy();
        expect(screen.getByRole('radiogroup')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
        await screen.findByRole('heading', { name: 'Team payouts' });

        fireEvent.click(actionRow('look'));
        await screen.findByRole('heading', { name: 'Edit Look' });
        fireEvent.click(screen.getByRole('radio', { name: /#1E90C7/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByRole('heading', { name: 'Team payouts' });
        const stored = JSON.parse(localStorage.getItem(`xc.walletTile.list:${CHAIN}:77`));
        expect(stored).toMatchObject({ colour: '#1E90C7', shape: 'circle', image: null });
        expect(container.querySelector('[data-xc-avatar]').style.getPropertyValue('--xc-avatar-tone')).toBe('#1E90C7');
    });

    it('shows a saved image and its shape on the identity icon', async () => {
        localStorage.setItem(`xc.walletTile.list:${CHAIN}:77`, JSON.stringify({ image: 'data:image/png;base64,AAAA', shape: 'rounded' }));
        mountDetail();
        await screen.findByRole('heading', { name: 'Team payouts' });
        const icon = screen.getByRole('button', { name: 'Edit look' });
        expect(icon.querySelector('[data-xc-avatar] img').getAttribute('src')).toBe('data:image/png;base64,AAAA');
        expect(icon.firstElementChild.style.getPropertyValue('--xc-avatar-shape')).toBe('24%');
    });
});

describe('ListDetail List tab', () => {
    it('shows a standard list in one card with addresses cut in the middle', async () => {
        const { container } = mountDetail();
        await openTab('List');
        const card = (await screen.findByLabelText(MEMBERS[0])).closest('ul');
        expect(container.querySelectorAll('ul')).toHaveLength(1);
        expect(card.querySelectorAll('li')).toHaveLength(3);
        for (const [i, li] of [...card.querySelectorAll('li')].entries()) {
            expect(li.textContent).toContain('…');
            expect(li.textContent).not.toContain('_');
            expect(li.textContent).not.toBe(MEMBERS[i]);
        }
    });

    it('groups a union list under each source list name', async () => {
        const { messaging } = mountDetail({ row: UNION_LIST });
        await screen.findByRole('heading', { name: 'Combined allow list' });
        // The source lists are read only once the List tab opens.
        expect(messaging.getListByActionIndex).toHaveBeenCalledTimes(1);
        await openTab('List');
        const team = await screen.findByRole('region', { name: 'Team payouts' });
        const partners = screen.getByRole('region', { name: 'Partners' });
        expect(within(team).getByText('#908124001 · 3 members')).toBeTruthy();
        expect(within(partners).getByText('#907455210 · 2 members')).toBeTruthy();
        expect(within(team).getAllByRole('listitem')).toHaveLength(3);
        expect(within(partners).getAllByRole('listitem')).toHaveLength(2);
        expect(within(partners).getByLabelText(PARTNERS[0])).toBeTruthy();
        // The union itself plus one read per source list.
        expect(messaging.getListByActionIndex).toHaveBeenCalledTimes(3);
    });

    it('sends a union Edit to its source lists', async () => {
        const onEdit = vi.fn();
        mountDetail({ row: UNION_LIST, handlers: { onEdit } });
        await waitFor(() => expect(isLocked(actionRow('edit'))).toBe(false));
        fireEvent.click(actionRow('edit'));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ type: '3', items: ['908124001', '907455210'] }));
        expect(isLocked(actionRow('share'))).toBe(true);
        expect(screen.getByText('A union list cannot be shared in this release.')).toBeTruthy();
    });
});

describe('ListDetail Details tab', () => {
    function rowLabels() {
        const card = screen.getByRole('list', { name: 'List details' });
        return within(card).getAllByRole('listitem').map((li) => li.querySelector('span span').textContent);
    }

    it('lists the facts label-left, value-right, in order, with no uppercase labels', async () => {
        mountDetail();
        await openTab('Details');
        await screen.findByText('Current owner');
        expect(rowLabels()).toEqual(['Network', 'Type', 'List index', 'Published by', 'Current owner', 'Status', 'Block']);
        const status = screen.getByText('Status').closest('li');
        expect(within(status).getByText('Valid')).toBeTruthy();
        expect(within(screen.getByText('List index').closest('li')).getByText('#77')).toBeTruthy();
        for (const label of rowLabels()) expect(label).not.toBe(label.toUpperCase());
    });

    it('adds Built from for a union list', async () => {
        mountDetail({ row: UNION_LIST });
        await openTab('Details');
        await screen.findByText('Current owner');
        expect(rowLabels()).toEqual(['Network', 'Type', 'List index', 'Built from', 'Published by', 'Current owner', 'Status', 'Block']);
        expect(within(screen.getByText('Built from').closest('li')).getByText('2 lists')).toBeTruthy();
        expect(within(screen.getByText('Type').closest('li')).getByText('Union list')).toBeTruthy();
    });

    it('shows no Used by text on any tab', async () => {
        mountDetail();
        await screen.findByRole('heading', { name: 'Team payouts' });
        for (const name of ['Actions', 'List', 'Details']) {
            await openTab(name);
            expect(screen.queryByText(/Used by/i)).toBeNull();
            expect(document.body.textContent).not.toMatch(/reverse lookup/i);
        }
    });
});
