// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { selectOption } from '../../helpers/selectOption.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';

const SHELLS = [
    ['web', '../../../packages/web/src/App.jsx'],
    ['extension', '../../../packages/extension/src/popup/App.jsx'],
    ['desktop', '../../../packages/desktop/renderer/App.jsx'],
].map(([name, path]) => [name, readFileSync(new URL(path, import.meta.url), 'utf8')]);

// Every list action view renders the one List form with its action picked.
const LIST_ACTION_VIEWS = [
    ['list-rename', 'edit'],
    ['list-share', 'share'],
    ['list-transfer', 'transfer'],
    ['list-fork', 'fork'],
];

afterEach(cleanup);

describe.each(SHELLS)('%s list sharing routes', (_name, source) => {
    // Walk 2026-11-13, screen 123: the Shared lists page is retired into My
    // Lists with Show set to Shared with me.
    it('has no separate shared-lists route', () => {
        expect(source).not.toContain("'shared-lists'");
        expect(source).not.toContain('<SharedListDirectory');
        expect(source).not.toContain('onOpenSharedLists');
    });

    it.each(LIST_ACTION_VIEWS)('renders %s as the List form on %s', (view, action) => {
        expect(source).toMatch(new RegExp(`unlockedView === '${view}'[\\s\\S]*?<ListCreateForm\\s+action="${action}"`));
    });

    it('opens Edit from the list page on the List form', () => {
        expect(source).toContain("onEdit={(ref) => { setListForkRef(ref); setUnlockedView('list-rename'); }}");
    });

    // Operator ruling 2026-11-14: no editing in modals, so Edit look is a page.
    it('routes Edit look to its own page and back to the list', () => {
        expect(source).toContain("onEditLook={() => setUnlockedView('list-look')}");
        expect(source).toMatch(/unlockedView === 'list-look'[\s\S]*?<ListLookForm[\s\S]*?onBack=\{goBack\}[\s\S]*?onDone=\{goBack\}/);
    });

    // Union is a type on Create List; nothing opens a separate union route,
    // so the shells carry none (routeReachability keeps every route reachable).
    it('has no separate list-union route', () => {
        expect(source).not.toContain("unlockedView === 'list-union'");
    });

    it('passes the list navigation handlers', () => {
        expect(source).toContain("onShare={listRef.origin === 'shared' ? undefined");
        expect(source).toContain("onTransfer={listRef.origin === 'shared' ? undefined");
        // Union is a List type in Create List; My Lists has no union entry.
        expect(source).not.toContain('onCreateUnionList');
        // A row opened from Show: Shared with me carries its shared origin.
        expect(source).toContain('onOpenList={(cid, actionIndex, shared)');
        expect(source).toMatch(/unlockedView === 'list-detail'[\s\S]*?onBack=\{goBack\}/);
    });

    it('opens the access-list form at the shared block picker', () => {
        // The token page's owner actions take their handlers as one map now
        // (G12: a coin and a token share one detail page).
        expect(source).toContain("onUseSharedBlockList: (ctx) => openOwnerForm('access-lists', ctx,");
        expect(source).toContain("{ initialPicker: 'shared-block' }");
        expect(source).toContain('initialPicker={tokenAdminInitialPicker || undefined}');
    });
});

function makeMessaging() {
    return {
        getListByActionIndex: vi.fn().mockResolvedValue({
            type: '2',
            status: 'valid',
            source: 'bc1qowner',
            list: ['bc1qmember'],
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getListsForSource: vi.fn().mockResolvedValue([]),
    };
}

function mountDetail(props = {}) {
    render(
        <MessagingProvider shell="web" messaging={makeMessaging()}>
            <ListDetail
                chainId="bitcoin-mainnet"
                actionIndex="7"
                onBack={() => {}}
                onFork={() => {}}
                {...props}
            />
        </MessagingProvider>,
    );
}

describe('list page sharing entries', () => {
    it('shows detail entries only when their handlers are passed', async () => {
        mountDetail();
        await screen.findByRole('button', { name: /^Fork\b/ });
        expect(screen.queryByRole('button', { name: /^Share\b/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Transfer\b/ })).toBeNull();
        cleanup();

        const onShare = vi.fn();
        const onTransfer = vi.fn();
        mountDetail({ onShare, onTransfer });
        await screen.findByRole('button', { name: /^Fork\b/ });
        fireEvent.click(screen.getByRole('button', { name: /^Share\b/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Transfer\b/ }));
        expect(onShare).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', actionIndex: '7' });
        expect(onTransfer).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', actionIndex: '7' });
    });

    // Operator 2026-11-13: My lists has no Create union list or Shared lists
    // button; the shared directory is the filter's Show choice instead.
    it('offers the shared directory through Show, not a Shared lists button', async () => {
        const onOpenList = vi.fn();
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ address: 'bc1qowner' }] }),
            getListsForSource: vi.fn().mockResolvedValue({ data: [] }),
            getSharedLists: vi.fn().mockResolvedValue({
                lists: [{ home_chain: 'bitcoin-mainnet', home_list_index: 42, type: 2, owner: 'bc1qother', name: 'Partners' }],
                unavailable: [],
            }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MyLists walletId="wallet-1" onOpenList={onOpenList} onCreateList={() => {}} onCreateUnionList={() => {}} onOpenSharedLists={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByText('No lists yet');
        expect(screen.queryByText('Create Union List')).toBeNull();
        expect(screen.queryByText('Shared Lists')).toBeNull();
        expect(messaging.getSharedLists).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Filter lists' }));
        selectOption(screen.getByRole('combobox', { name: 'Show lists' }), 'shared');
        const row = await screen.findByRole('button', { name: /Partners/ });
        expect(messaging.getSharedLists).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet' });
        fireEvent.click(row);
        expect(onOpenList).toHaveBeenCalledWith('bitcoin-mainnet', '42', { origin: 'shared', directoryChainId: 'bitcoin-mainnet' });
    });

    // The retired Shared lists page opens here: initialShow starts Show at
    // Shared with me, and the shared rows render with their names and icons.
    it('starts at Shared with me when initialShow is shared', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ address: 'bc1qowner' }] }),
            getListsForSource: vi.fn().mockResolvedValue({ data: [] }),
            getSharedLists: vi.fn().mockResolvedValue({
                lists: [
                    { home_chain: 'bitcoin-mainnet', home_list_index: 42, type: 2, owner: 'bc1qother', name: 'Partners' },
                    { home_chain: 'bitcoin-mainnet', home_list_index: 43, type: 1, owner: 'bc1qother', name: 'Gate tokens' },
                ],
                unavailable: [],
            }),
        };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MyLists walletId="wallet-1" initialShow="shared" onOpenList={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );
        expect(await screen.findByRole('button', { name: /Partners/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Gate tokens/ })).toBeTruthy();
        expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
        expect(messaging.getSharedLists).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet' });
    });
});
