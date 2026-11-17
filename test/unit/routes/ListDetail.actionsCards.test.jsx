// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qowneraddress0000000000000000000000000';

function members(count) {
    return Array.from({ length: count }, (_, i) => `bc1qmember${String(i).padStart(4, '0')}000000000000000000000`);
}

function mountDetail({ row, handlers = {} } = {}) {
    const messaging = {
        getListByActionIndex: vi.fn().mockResolvedValue({
            type: '2', status: 'valid', source: OWNER, list: members(3), ...row,
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OWNER }] }),
        getActionFormats: vi.fn().mockResolvedValue([{ format: 4 }]),
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListDetail
                walletId="wallet-1"
                chainId={CHAIN}
                actionIndex="77"
                onBack={() => {}}
                onFork={handlers.onFork || (() => {})}
                onShare={() => {}}
                onTransfer={() => {}}
                onRename={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

// The entries live on the List tab; Actions is the tab a list opens on.
async function openListTab() {
    fireEvent.click(await screen.findByRole('tab', { name: 'List' }));
}

describe('ListDetail actions and member cards', () => {
    it('draws the actions as the shared action list under Actions, the first and chosen tab (G101, G102)', async () => {
        const onFork = vi.fn();
        mountDetail({ handlers: { onFork } });
        const tabs = within(await screen.findByRole('tablist', { name: 'List detail view' })).getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'List', 'Details']);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

        const list = await screen.findByRole('list', { name: 'List actions' });
        expect(list.tagName).toBe('UL');
        const rows = within(list).getAllByRole('listitem');
        expect(rows.map((item) => item.querySelector('[data-action-id]')?.getAttribute('data-action-id')))
            .toEqual(['edit', 'share', 'transfer', 'fork', 'look']);
        // Every row has its icon square, a description and the default tone;
        // a list has no destructive action.
        for (const item of rows) {
            const row = item.querySelector('[data-action-id]');
            expect(row.querySelector('[aria-hidden="true"] svg')).toBeTruthy();
            expect(row).toHaveAttribute('data-tone', 'default');
        }
        const fork = within(list).getByRole('button', { name: /^Fork\b/ });
        expect(fork).toHaveTextContent('Publish an edit of the members at a new list index');
        fireEvent.click(fork);
        expect(onFork).toHaveBeenCalledWith(expect.objectContaining({ chainId: CHAIN, actionIndex: '77' }));
        // Edit look opens its own page, never a modal.
        fireEvent.click(within(list).getByRole('button', { name: /^Edit look\b/ }));
        expect(await screen.findByRole('heading', { name: 'Edit Look' })).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
        expect(await screen.findByRole('tablist', { name: 'List detail view' })).toBeTruthy();
    });

    it('hands Edit look to the shell when it passes onEditLook', async () => {
        const onEditLook = vi.fn();
        const messaging = {
            getListByActionIndex: vi.fn().mockResolvedValue({ type: '2', status: 'valid', source: OWNER, list: members(3) }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OWNER }] }),
            getActionFormats: vi.fn().mockResolvedValue([{ format: 4 }]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ListDetail walletId="wallet-1" chainId={CHAIN} actionIndex="77" onBack={() => {}} onFork={() => {}} onEditLook={onEditLook} />
            </MessagingProvider>,
        );
        fireEvent.click(within(await screen.findByRole('list', { name: 'List actions' })).getByRole('button', { name: /^Edit look\b/ }));
        expect(onEditLook).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '77' });
        expect(screen.queryByRole('heading', { name: 'Edit Look' })).toBeNull();
    });

    it('gives Load more members an icon and keeps it with the card', async () => {
        mountDetail({ row: { list: members(30) } });
        await openListTab();
        const more = await screen.findByRole('button', { name: 'Load More Members' });
        expect(more.querySelector('svg')).toBeTruthy();
        fireEvent.click(more);
        expect(screen.queryByRole('button', { name: 'Load More Members' })).toBeNull();
    });

    it('draws the members in one list card with no inline styles', async () => {
        const { container } = mountDetail();
        await openListTab();
        await screen.findByLabelText(members(3)[0]);
        const lists = container.querySelectorAll('ul');
        expect(lists).toHaveLength(1);
        const card = lists[0];
        expect(card.querySelectorAll('li')).toHaveLength(3);
        expect(card.getAttribute('style')).toBeNull();
        for (const li of card.querySelectorAll('li')) expect(li.getAttribute('style')).toBeNull();
    });

    it('draws the left-out items and the empty members line without inline styles', async () => {
        const { container } = mountDetail({
            row: { list: [], edits: [{ address: 'bad-one', status: 'invalid_address' }] },
        });
        await openListTab();
        await screen.findByText(/No list members/);
        expect(screen.getByText(/No list members/).getAttribute('style')).toBeNull();
        const lists = container.querySelectorAll('ul');
        expect(lists.length).toBeGreaterThan(0);
        for (const ul of lists) {
            expect(ul.getAttribute('style')).toBeNull();
            for (const li of ul.querySelectorAll('li')) expect(li.getAttribute('style')).toBeNull();
        }
    });

    it('draws a fork edit as one list card', async () => {
        const { container } = mountDetail({
            row: { list_action_index: '12', edit: '1', edits: [{ address: members(1)[0], status: 'valid' }, { address: members(2)[1], status: 'valid' }] },
        });
        await openListTab();
        await screen.findByText("This fork's edit");
        const cards = [...container.querySelectorAll('ul')].filter((ul) => ul.querySelectorAll('li').length === 2);
        expect(cards.length).toBeGreaterThan(0);
        for (const card of cards) expect(card.getAttribute('style')).toBeNull();
    });
});
