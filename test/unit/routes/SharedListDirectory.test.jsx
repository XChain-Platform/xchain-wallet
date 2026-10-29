// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SharedListDirectory } from '../../../packages/core/src/shared/routes/SharedListDirectory.jsx';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        ChainBadge: ({ descriptor }) => <span role="img" aria-label={descriptor.displayName} />,
    };
});

const CHAIN = 'bitcoin-mainnet';
const ENTRIES = [
    {
        kind: 'home',
        home_chain: 'BTC',
        home_list_index: 12,
        type: 1,
        owner: 'bc1qordinaryowner1234567890',
        member_count: 4,
        share_block: 102,
        bindTarget: 1012,
        maintainedByPlatform: false,
    },
    {
        kind: 'home',
        home_chain: 'LTC',
        home_list_index: 8,
        type: 2,
        owner: 'ltc1platformowner1234567890',
        member_count: 2,
        share_block: 88,
        bindTarget: 2008,
        maintainedByPlatform: true,
    },
    {
        kind: 'home',
        home_chain: 'DOGE',
        home_list_index: 4,
        type: 1,
        owner: 'DUnmirroredOwner',
        member_count: 1,
        share_block: 77,
        bindTarget: null,
        maintainedByPlatform: false,
    },
];

function mount({ mode = 'browse', filterType, onSelect = vi.fn(), onOpenList, response } = {}) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSharedLists: vi.fn().mockResolvedValue(response ?? {
            lists: ENTRIES,
            unavailable: [],
        }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SharedListDirectory
                walletId="wallet-1"
                chainId={CHAIN}
                mode={mode}
                filterType={filterType}
                onSelect={onSelect}
                onOpenList={onOpenList}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return { messaging, onSelect };
}

afterEach(cleanup);

describe('SharedListDirectory', () => {
    it('shows the platform badge and keeps unbadged lists in the directory', async () => {
        mount();

        expect(await screen.findByText('Maintained by XChain Platform')).toBeTruthy();
        expect(screen.getByRole('listitem', { name: 'Token list 12' })).toBeTruthy();
        expect(screen.getByRole('listitem', { name: 'Address list 8' })).toBeTruthy();
        expect(screen.getByText('bc1qor...7890')).toBeTruthy();
        expect(screen.getByText('not yet mirrored here')).toBeTruthy();
    });

    it('orders platform lists before the remaining home chains', async () => {
        mount();

        const rows = await screen.findAllByRole('listitem');
        expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
            'Address list 8',
            'Token list 12',
            'Token list 4',
        ]);
    });

    it('filters pick mode and returns the local bind target', async () => {
        const onSelect = vi.fn();
        const state = mount({ mode: 'pick', filterType: 'address', onSelect });

        const row = await screen.findByRole('listitem', { name: 'Address list 8' });
        expect(screen.queryByRole('listitem', { name: 'Token list 12' })).toBeNull();
        fireEvent.click(within(row).getByRole('button', { name: 'Choose list' }));

        expect(state.messaging.getSharedLists).toHaveBeenCalledWith({ chainId: CHAIN });
        expect(onSelect).toHaveBeenCalledWith({
            actionIndex: 2008,
            homeChain: 'LTC',
            homeListIndex: 8,
            memberCount: 2,
        });
    });

    it('does not offer an unmirrored list in pick mode', async () => {
        mount({ mode: 'pick', filterType: 'token' });

        expect(await screen.findByRole('listitem', { name: 'Token list 12' })).toBeTruthy();
        expect(screen.queryByRole('listitem', { name: 'Token list 4' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Choose list' })).toHaveLength(1);
    });

    it('renders one unavailable line for each failed chain', async () => {
        mount({
            response: {
                lists: [],
                unavailable: ['litecoin-mainnet', 'dogecoin-mainnet'],
            },
        });

        expect(await screen.findByRole('img', { name: 'Litecoin' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Dogecoin' })).toBeTruthy();
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
    });

    it('names every failed chain in one notice and shows no empty state beside it', async () => {
        mount({
            response: {
                lists: [],
                unavailable: ['litecoin-mainnet', 'dogecoin-mainnet'],
            },
        });

        await screen.findByRole('img', { name: 'Litecoin' });
        const notices = screen.getAllByText(/Shared lists unavailable/);
        expect(notices).toHaveLength(1);
        expect(within(notices[0].closest('[role="alert"], [role="status"]') || notices[0]).getByRole('img', { name: 'Dogecoin' }))
            .toBeTruthy();
        expect(screen.queryByText('No shared lists yet')).toBeNull();
    });

    it('does not expose an unknown network kind through fallback text', async () => {
        mount({
            response: {
                lists: [{ ...ENTRIES[0], home_chain: 'unknown-regtest-chain' }],
                unavailable: ['unknown-testnet-chain'],
            },
        });

        await screen.findByRole('listitem');
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
    });

    it('searches every entry and distinguishes no matches from an empty directory', async () => {
        mount({
            response: {
                lists: [
                    ...ENTRIES,
                    { ...ENTRIES[0], home_list_index: 99, bindTarget: 1099, name: 'Treasury assets' },
                ],
                unavailable: [],
            },
        });

        await screen.findByRole('listitem', { name: 'Token list 99' });
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search shared lists' }), {
            target: { value: 'treasury' },
        });

        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        expect(screen.getByText('Treasury assets')).toBeTruthy();

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search shared lists' }), {
            target: { value: 'missing' },
        });
        expect(screen.getByText('No matching shared lists')).toBeTruthy();
        expect(screen.queryByText('No shared lists are available.')).toBeNull();
    });

    it('pages long directories and opens a list on its home chain', async () => {
        const onOpenList = vi.fn();
        const lists = Array.from({ length: 23 }, (_, index) => ({
            ...ENTRIES[0],
            home_list_index: index + 1,
            bindTarget: 1000 + index,
        }));
        mount({ response: { lists, unavailable: [] }, onOpenList });

        expect(await screen.findAllByRole('listitem')).toHaveLength(20);
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search shared lists' }), {
            target: { value: '1022' },
        });
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        expect(screen.getByRole('listitem', { name: 'Token list 23' })).toBeTruthy();

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search shared lists' }), {
            target: { value: '' },
        });
        expect(screen.getAllByRole('listitem')).toHaveLength(20);
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(23);

        const row = screen.getByRole('listitem', { name: 'Token list 23' });
        fireEvent.click(within(row).getByRole('button', { name: 'Open list' }));
        expect(onOpenList).toHaveBeenCalledWith('bitcoin-mainnet', '23');
    });

    it('shows the request failure instead of an empty directory', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getSharedLists: vi.fn()
                .mockRejectedValueOnce(new Error('Directory unavailable'))
                .mockResolvedValueOnce({ lists: [], unavailable: [] }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SharedListDirectory
                    walletId="wallet-1"
                    chainId={CHAIN}
                    mode="browse"
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Directory unavailable')).toBeTruthy();
        expect(screen.queryByText('No shared lists are available.')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByText('No shared lists yet')).toBeTruthy();
        expect(messaging.getSharedLists).toHaveBeenCalledTimes(2);
    });

    it('keeps valid entries when the directory response contains malformed rows', async () => {
        mount({
            response: {
                lists: [undefined, ENTRIES[0], 7],
                unavailable: [],
            },
        });

        expect(await screen.findByRole('listitem', { name: 'Token list 12' })).toBeTruthy();
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('neutralizes and caps the indexer text a directory row shows', async () => {
        mount({
            response: {
                lists: [{
                    kind: 'home',
                    home_chain: 'BTC',
                    home_list_index: '12\u202E21',
                    type: 2,
                    owner: 'bc1q\u202Elive',
                    member_count: 1,
                    share_block: 'x'.repeat(5000),
                    bindTarget: 12,
                    name: 'n'.repeat(100000),
                }],
                unavailable: [],
            },
        });

        const row = await screen.findByRole('listitem', { name: 'Address list 12\u242621' });
        const text = row.textContent;
        expect(text).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
        expect(within(row).getByText('bc1q\u2426live')).toBeTruthy();
        expect(within(row).getByText(`${'n'.repeat(63)}…`)).toBeTruthy();
        expect(within(row).getByText(`${'x'.repeat(99)}…`)).toBeTruthy();
        expect(text.length).toBeLessThan(1000);
    });
});
