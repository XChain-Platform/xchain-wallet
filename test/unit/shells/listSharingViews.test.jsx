// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';

const SHELLS = [
    ['web', '../../../packages/web/src/App.jsx'],
    ['extension', '../../../packages/extension/src/popup/App.jsx'],
    ['desktop', '../../../packages/desktop/renderer/App.jsx'],
].map(([name, path]) => [name, readFileSync(new URL(path, import.meta.url), 'utf8')]);

const VIEW_COMPONENTS = [
    ['list-share', 'ListShareForm'],
    ['list-transfer', 'ListTransferForm'],
    ['list-union', 'UnionListForm'],
    ['shared-lists', 'SharedListDirectory'],
];

afterEach(cleanup);

describe.each(SHELLS)('%s list sharing routes', (_name, source) => {
    it.each(VIEW_COMPONENTS)('names %s and renders %s', (view, component) => {
        expect(source).toContain(`'${view}'`);
        expect(source).toContain(`<${component}`);
    });

    it('passes the list navigation handlers', () => {
        expect(source).toContain('onShare={(ref)');
        expect(source).toContain('onTransfer={(ref)');
        expect(source).toContain('onCreateUnionList={()');
        expect(source).toContain('onOpenSharedLists={()');
        expect(source).toContain('mode="browse"');
    });

    it('opens the access-list form at the shared block picker', () => {
        expect(source).toContain('onUseSharedBlockList={()');
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

function mountMyLists(props = {}) {
    render(
        <MessagingProvider shell="web" messaging={makeMessaging()}>
            <MyLists walletId="wallet-1" onOpenList={() => {}} onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

describe('list page sharing entries', () => {
    it('shows detail entries only when their handlers are passed', async () => {
        mountDetail();
        await screen.findByText('Fork & edit');
        expect(screen.queryByText('Share list')).toBeNull();
        expect(screen.queryByText('Transfer list')).toBeNull();
        cleanup();

        const onShare = vi.fn();
        const onTransfer = vi.fn();
        mountDetail({ onShare, onTransfer });
        await screen.findByText('Fork & edit');
        fireEvent.click(screen.getByText('Share list'));
        fireEvent.click(screen.getByText('Transfer list'));
        expect(onShare).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', actionIndex: '7' });
        expect(onTransfer).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', actionIndex: '7' });
    });

    it('shows list directory entries only when their handlers are passed', () => {
        mountMyLists();
        expect(screen.queryByText('Create union list')).toBeNull();
        expect(screen.queryByText('Shared lists')).toBeNull();
        cleanup();

        const onCreateUnionList = vi.fn();
        const onOpenSharedLists = vi.fn();
        mountMyLists({ onCreateUnionList, onOpenSharedLists });
        fireEvent.click(screen.getByText('Create union list'));
        fireEvent.click(screen.getByText('Shared lists'));
        expect(onCreateUnionList).toHaveBeenCalledOnce();
        expect(onOpenSharedLists).toHaveBeenCalledOnce();
    });
});
