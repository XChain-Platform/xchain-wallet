// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The list picker's three views (All, Recent, My lists), its title bar
// search over published lists, and the per-wallet recents.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ListPickerScreen } from '@xchain-wallet/core/shared/components/ListPickerScreen.jsx';
import {
    listPickerRecentsKey,
    readListPickerRecents,
} from '@xchain-wallet/core/shared/utils/listPickerRecents.js';

const CHAIN = 'bitcoin-regtest';

const OFAC = {
    home_chain: 'BTC',
    home_list_index: 7,
    type: 2,
    name: 'OFAC sanctioned addresses',
    owner: 'bc1qplatform',
    member_count: 120,
    share_block: 100,
    bind_target: 501,
    maintained_by_platform: true,
};
const TOKEN_LIST = { ...OFAC, home_list_index: 8, type: 1, name: 'Token list', bind_target: 502 };

function messagingFor({ own = [], shared = [OFAC, TOKEN_LIST], details = {} } = {}) {
    return {
        getListsForSource: vi.fn().mockResolvedValue(own),
        getListByActionIndex: vi.fn(async ({ actionIndex }) => details[actionIndex] || { type: '2', list: ['a', 'b'] }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: shared, unavailable: [] }),
    };
}

function renderPicker(messaging, props = {}) {
    const onSelect = vi.fn();
    render(
        <ListPickerScreen
            variant="full"
            messaging={messaging}
            chainId={CHAIN}
            addresses={[{ address: 'addr1' }]}
            filterType="2"
            walletId="w1"
            title="Select Block List"
            onSelect={onSelect}
            onBack={() => {}}
            {...props}
        />,
    );
    return onSelect;
}

function openSearch() {
    fireEvent.click(screen.getByRole('button', { name: 'Filter lists' }));
    return screen.getByRole('searchbox', { name: 'Search lists' });
}

beforeEach(() => { globalThis.localStorage.clear(); });
afterEach(() => cleanup());

describe('ListPickerScreen views', () => {
    it('opens on My lists when the wallet has lists, with the three-way toggle', async () => {
        const messaging = messagingFor({ own: [{ action_index: '10', type: '2' }] });
        renderPicker(messaging);

        expect(await screen.findByRole('button', { name: /Address list #10/ })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Select Block List' })).toBeTruthy();
        const views = screen.getByRole('radiogroup', { name: 'Which lists' });
        expect([...views.querySelectorAll('[role="radio"]')].map((el) => el.textContent))
            .toEqual(['All', 'Recent', 'My lists']);
        expect(screen.getByRole('radio', { name: 'My lists' })).toHaveAttribute('aria-checked', 'true');
        // The directory is read only once All is opened.
        expect(messaging.getSharedLists).not.toHaveBeenCalled();
        // Selection rows carry no chevron (G97).
        expect(screen.getByRole('button', { name: /Address list #10/ }).querySelector('[class*="chevron"]')).toBeNull();
    });

    it('opens on All when the wallet has no lists, offering published address lists only', async () => {
        const messaging = messagingFor();
        renderPicker(messaging);

        const row = await screen.findByRole('button', { name: /OFAC sanctioned addresses \(List #501\)/ });
        expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
        expect(row).toHaveTextContent('Address list · shared from BTC list #7 · 120 members');
        expect(screen.queryByText(/Token list/)).toBeNull();
    });

    it('returns a pick from each view', async () => {
        const messaging = messagingFor({ own: [{ action_index: '10', type: '2', name: 'Mine' }] });
        const onSelect = renderPicker(messaging);

        fireEvent.click(await screen.findByRole('button', { name: /Mine \(List #10\)/ }));
        await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
        expect(onSelect.mock.calls[0][0]).toMatchObject({ actionIndex: '10', type: '2', name: 'Mine' });

        fireEvent.click(screen.getByRole('radio', { name: 'All' }));
        fireEvent.click(await screen.findByRole('button', { name: /OFAC sanctioned addresses/ }));
        expect(onSelect.mock.calls[1][0]).toEqual({
            actionIndex: '501',
            type: '2',
            memberCount: 120,
            name: 'OFAC sanctioned addresses',
            homeChain: 'BTC',
            homeListIndex: '7',
            shared: true,
        });

        fireEvent.click(screen.getByRole('radio', { name: 'Recent' }));
        fireEvent.click(await screen.findByRole('button', { name: /OFAC sanctioned addresses/ }));
        expect(onSelect.mock.calls[2][0]).toMatchObject({ actionIndex: '501', homeChain: 'BTC', shared: true });
    });

    it('finds a published list by name, description or index from the title bar search', async () => {
        const messaging = messagingFor({ own: [{ action_index: '10', type: '2', name: 'Mine' }] });
        renderPicker(messaging, { initialTab: 'all' });
        await screen.findByRole('button', { name: /OFAC sanctioned addresses/ });

        const search = openSearch();
        fireEvent.change(search, { target: { value: 'OFAC' } });
        expect(screen.getByRole('button', { name: /OFAC sanctioned addresses/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Mine \(List #10\)/ })).toBeNull();

        fireEvent.change(search, { target: { value: '501' } });
        expect(screen.getByRole('button', { name: /OFAC sanctioned addresses/ })).toBeTruthy();
    });

    it('looks up a typed list index nobody listed and offers it when it is an address list', async () => {
        const messaging = messagingFor({
            shared: [],
            details: {
                777: { action: 'LIST', type: '2', name: 'Someone else', list: ['a', 'b', 'c'], status: 'valid' },
                778: { action: 'LIST', type: '1', name: 'Tokens', list: ['X'] },
            },
        });
        const onSelect = renderPicker(messaging);
        await screen.findByText('No lists found');

        const search = openSearch();
        fireEvent.change(search, { target: { value: '777' } });
        const row = await screen.findByRole('button', { name: /Someone else \(List #777\)/ });
        expect(row).toHaveTextContent('3 members');
        fireEvent.click(row);
        expect(onSelect).toHaveBeenCalledWith({ actionIndex: '777', type: '2', memberCount: 3, name: 'Someone else' });

        fireEvent.change(search, { target: { value: '778' } });
        await waitFor(() => expect(messaging.getListByActionIndex).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '778' }));
        expect(screen.queryByRole('button', { name: /Tokens/ })).toBeNull();
    });

    it('records each pick in this wallet\'s recents, newest first, and keeps other wallets apart', async () => {
        const messaging = messagingFor({ own: [{ action_index: '10', type: '2' }, { action_index: '11', type: '2' }] });
        renderPicker(messaging);

        fireEvent.click(await screen.findByRole('button', { name: /Address list #10/ }));
        fireEvent.click(screen.getByRole('button', { name: /Address list #11/ }));
        fireEvent.click(screen.getByRole('button', { name: /Address list #10/ }));

        expect(readListPickerRecents('w1', CHAIN).map((row) => row.actionIndex)).toEqual(['10', '11']);
        expect(readListPickerRecents('w2', CHAIN)).toEqual([]);
        expect(globalThis.localStorage.getItem(listPickerRecentsKey('w1', CHAIN))).toContain('"10"');

        fireEvent.click(screen.getByRole('radio', { name: 'Recent' }));
        const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
        expect(rows[0]).toMatch(/Address list #10/);
        expect(rows[1]).toMatch(/Address list #11/);
    });

    it('shows an empty Recent view and hides Recent without a wallet', async () => {
        renderPicker(messagingFor({ own: [{ action_index: '10', type: '2' }] }));
        await screen.findByRole('button', { name: /Address list #10/ });
        fireEvent.click(screen.getByRole('radio', { name: 'Recent' }));
        expect(screen.getByText('No recent lists')).toBeTruthy();
        cleanup();

        renderPicker(messagingFor({ own: [{ action_index: '10', type: '2' }] }), { walletId: undefined });
        await screen.findByRole('button', { name: /Address list #10/ });
        expect(screen.queryByRole('radio', { name: 'Recent' })).toBeNull();
    });

    it('keeps My lists usable when the published directory fails', async () => {
        const messaging = messagingFor({ own: [{ action_index: '10', type: '2' }] });
        messaging.getSharedLists.mockRejectedValue(new Error('down'));
        renderPicker(messaging, { initialTab: 'all' });

        expect(await screen.findByText(/Published lists didn’t load/)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Address list #10/ })).toBeTruthy();
    });
});
