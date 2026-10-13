// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const CREATOR = 'bcrt1qcreatorcreatorcreatorcreatorcreator00';
const HOLDER = 'bcrt1qholderholderholderholderholder0000';

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

beforeEach(() => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
    });
});
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function mount({
    holders = { data: [] },
    holdersError = null,
    holdersLookup = null,
    tokenInfoLookup = null,
    settings = { walletMode: 'full' },
    props = {},
} = {}) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue(settings),
        getTokenInfo: tokenInfoLookup || vi.fn().mockResolvedValue({ creator: CREATOR }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: holdersLookup || (holdersError
            ? vi.fn().mockRejectedValue(holdersError)
            : vi.fn().mockResolvedValue(holders)),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId="wallet"
                chainId={CHAIN}
                tick="DETAILPROBE"
                kind="token"
                quantity="10"
                divisibility={0}
                onBack={() => {}}
                {...props}
            />
        </MessagingProvider>,
    );
    return messaging;
}

describe('TokenDetail holders', () => {
    it('renders the explorer amount and copies the complete holder address', async () => {
        mount({ holders: { data: [{ address: HOLDER, amount: '12345.5' }] } });

        fireEvent.click(screen.getByRole('tab', { name: 'Unlock' }));

        expect(await screen.findByText('12,345.5')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Copy holder address 1' }));
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(HOLDER));
    });

    it('distinguishes an empty list from a failed holder lookup', async () => {
        mount();
        fireEvent.click(screen.getByRole('tab', { name: 'Unlock' }));
        expect(await screen.findByText('No holders yet')).toBeTruthy();

        cleanup();
        __clearTokenInfoCache();
        mount({ holdersError: new Error('explorer offline') });
        fireEvent.click(screen.getByRole('tab', { name: 'Unlock' }));
        expect(await screen.findByText(/couldn't load the holders/i)).toBeTruthy();
        expect(screen.queryByText('No holders yet')).toBeNull();
    });

    it('bounds a holder response with thousands of rows and expands without moving the page', async () => {
        const data = Array.from({ length: 5_000 }, (_, index) => ({
            address: `bcrt1qholder${String(index).padStart(5, '0')}xxxxxxxxxxxxxxxxxxxx`,
            amount: String(index + 1),
        }));
        mount({ holders: { data, total: data.length } });
        fireEvent.click(screen.getByRole('tab', { name: 'Unlock' }));

        await screen.findByText('Holders (5000)');
        const list = screen.getByRole('table', { name: 'Holder balances' });
        expect(list.querySelectorAll('tbody tr')).toHaveLength(100);
        expect(screen.getByRole('button', { name: 'Show more holders (100 of 5,000 shown)' })).toBeInTheDocument();

        const scroller = document.querySelector('main');
        scroller.scrollTop = 197;
        const showMore = screen.getByRole('button', { name: 'Show more holders (100 of 5,000 shown)' });
        showMore.focus();
        expect(document.activeElement).toBe(showMore);
        fireEvent.click(showMore);

        await waitFor(() => expect(list.querySelectorAll('tbody tr')).toHaveLength(200));
        expect(scroller.scrollTop).toBe(197);
    });

    it('copies the complete creator address from Details', async () => {
        mount();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));

        const copy = await screen.findByRole('button', { name: 'Copy creator address' });
        fireEvent.click(copy);
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CREATOR));
    });

    it('contains synchronous metadata and holder bridge failures', async () => {
        const getTokenInfo = vi.fn(() => { throw new Error('metadata bridge unavailable'); });
        const getHoldersForToken = vi.fn(() => { throw new Error('holders bridge unavailable'); });
        mount({ tokenInfoLookup: getTokenInfo, holdersLookup: getHoldersForToken });

        await waitFor(() => expect(getTokenInfo).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('tab', { name: 'Unlock' }));
        expect(await screen.findByText(/couldn't load the holders/i)).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Quick actions' })).toBeTruthy();
    });

    it('discards holder pagination and tab state when the token changes', async () => {
        let resolveOldPage;
        const oldPage = new Promise((resolve) => { resolveOldPage = resolve; });
        const first = Array.from({ length: 25 }, (_, index) => ({
            address: `${HOLDER}${index}`,
            amount: String(index + 1),
        }));
        const freshHolder = 'bcrt1qfreshholderholderholderholder000';
        const staleHolder = 'bcrt1qstaleholderholderholderholder000';
        const getHoldersForToken = vi.fn(({ tick, opts }) => {
            if (tick === 'OLD' && opts.page === 1) return Promise.resolve({ data: first, total: 50 });
            if (tick === 'OLD') return oldPage;
            return Promise.resolve({ data: [{ address: freshHolder, amount: '7' }], total: 1 });
        });
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getTokenInfo: vi.fn().mockResolvedValue({ creator: CREATOR }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
            getHoldersForToken,
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory: vi.fn().mockResolvedValue([]),
        };
        const tree = (tick) => (
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail walletId="wallet" chainId={CHAIN} tick={tick} kind="token" quantity="1" onBack={() => {}} />
            </MessagingProvider>
        );
        const view = render(tree('OLD'));
        fireEvent.click(screen.getByRole('tab', { name: 'Unlock' }));
        await screen.findByText('Holders (25 of 50)');
        fireEvent.click(screen.getByRole('button', { name: 'Load more holders' }));

        view.rerender(tree('NEW'));
        expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByRole('table', { name: 'Holder balances' })).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Unlock' }));
        expect(await screen.findByTitle(freshHolder)).toBeTruthy();

        await act(async () => {
            resolveOldPage({ data: [{ address: staleHolder, amount: '99' }], total: 50 });
        });
        expect(screen.getByTitle(freshHolder)).toBeTruthy();
        expect(screen.queryByTitle(staleHolder)).toBeNull();
    });

    it('uses the current chain when an identically keyed gated file is opened', async () => {
        const secondChain = 'litecoin-regtest';
        const group = [{
            keyHash: 'shared-key-hash',
            files: [{ actionIndex: '42', name: 'secret.txt', type: 'text/plain' }],
        }];
        const unlockGatedContent = vi.fn().mockResolvedValue({
            plaintextBase64: 'c2VjcmV0',
            byteLength: 6,
        });
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getTokenInfo: vi.fn().mockResolvedValue({ creator: CREATOR }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [], [secondChain]: [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue(group),
            listGatedKeys: vi.fn().mockResolvedValue([{ keyHash: 'shared-key-hash' }]),
            unlockGatedContent,
            getSupplyHistory: vi.fn().mockResolvedValue([]),
        };
        const tree = (chainId, tick) => (
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail walletId="wallet" chainId={chainId} tick={tick} kind="token" quantity="1" onBack={() => {}} />
            </MessagingProvider>
        );
        const view = render(tree(CHAIN, 'OLD'));
        fireEvent.click(screen.getByRole('tab', { name: 'Unlock' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Unlock and open secret.txt' }));
        await waitFor(() => expect(unlockGatedContent).toHaveBeenCalledWith(expect.objectContaining({ chainId: CHAIN, gateTicker: 'OLD' })));

        view.rerender(tree(secondChain, 'NEW'));
        fireEvent.click(screen.getByRole('tab', { name: 'Unlock' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Unlock and open secret.txt' }));
        await waitFor(() => expect(unlockGatedContent).toHaveBeenCalledTimes(2));
        expect(unlockGatedContent).toHaveBeenLastCalledWith(expect.objectContaining({
            chainId: secondChain,
            gateTicker: 'NEW',
        }));
    });
});

describe('TokenDetail actions', () => {
    it('renders applicable actions in Send, Receive, Trade order and invokes them', async () => {
        const onSend = vi.fn();
        const onReceive = vi.fn();
        const onBuy = vi.fn();
        mount({ props: { onSend, onReceive, onBuy } });

        await screen.findByRole('button', { name: 'Send' });
        const actions = within(screen.getByRole('group', { name: 'Quick actions' }))
            .getAllByRole('button');
        expect(actions.map((button) => button.getAttribute('aria-label') || button.textContent)).toEqual([
            'Send',
            'Receive',
            'Trade',
        ]);

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
        fireEvent.click(screen.getByRole('button', { name: 'Trade' }));
        expect(onSend).toHaveBeenCalledTimes(1);
        expect(onReceive).toHaveBeenCalledTimes(1);
        expect(onBuy).toHaveBeenCalledTimes(1);
    });

    it('hides Send in watch-only mode while retaining non-signing actions', async () => {
        mount({
            settings: { walletMode: 'watcher' },
            props: { onSend: vi.fn(), onReceive: vi.fn(), onBuy: vi.fn() },
        });

        await waitFor(() => expect(screen.queryByRole('button', { name: 'Send' })).toBeNull());
        expect(screen.getByRole('button', { name: 'Receive' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Trade' })).toBeTruthy();
    });

    it('keeps a zero-balance Send visible and shows why it is disabled', async () => {
        mount({ props: { quantity: '0', onSend: vi.fn() } });

        const send = await screen.findByRole('button', { name: 'Send' });
        expect(send.disabled).toBe(true);
        expect(send.title).toBe('No balance to send.');
        expect(screen.getByText('No balance to send.')).toBeTruthy();
    });
});
