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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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

describe('ListDetail actions and member cards', () => {
    it('gives every action button an icon', async () => {
        mountDetail();
        for (const name of ['Share list', 'Transfer list', 'Fork & edit']) {
            const button = await screen.findByRole('button', { name });
            expect(button.querySelector('svg'), name).toBeTruthy();
        }
    });

    it('gives Load more members an icon and keeps it with the card', async () => {
        mountDetail({ row: { list: members(30) } });
        const more = await screen.findByRole('button', { name: 'Load more members' });
        expect(more.querySelector('svg')).toBeTruthy();
        fireEvent.click(more);
        expect(screen.queryByRole('button', { name: 'Load more members' })).toBeNull();
    });

    it('draws the members in one list card with no inline styles', async () => {
        const { container } = mountDetail();
        await screen.findByText(members(3)[0]);
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
        await screen.findByText("This fork's edit");
        const cards = [...container.querySelectorAll('ul')].filter((ul) => ul.querySelectorAll('li').length === 2);
        expect(cards.length).toBeGreaterThan(0);
        for (const card of cards) expect(card.getAttribute('style')).toBeNull();
    });
});
