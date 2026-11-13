// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

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
    resetWalletModes();
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

// The information items are link rows at the foot of the Details tab.
function openDetails() {
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
}

function openMore(label) {
    openDetails();
    fireEvent.click(screen.getByRole('button', { name: label }));
}

describe('TokenDetail holders', () => {
    it('keeps Actions, Details and History as the tabs and lists the secondary token panels as Details rows', async () => {
        const description = 'A token description';
        mount({
            tokenInfoLookup: vi.fn().mockResolvedValue({
                creator: CREATOR,
                description,
                websites: ['https://issuer.example/'],
                images: [{ type: 'large', url: 'https://issuer.example/token.png' }],
            }),
        });

        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Actions', 'Details', 'History']);
        openDetails();
        expect(await screen.findByText(description)).toBeTruthy();
        expect([...document.querySelectorAll('[data-detail-id]')].map((item) => item.textContent)).toEqual([
            'Supply over time',
            'About',
            'Media',
            'Gated content',
            'Holders',
        ]);
        expect(screen.queryByRole('button', { name: /Price alert/ })).toBeNull();
    });

    it('hides empty supplemental metadata entries but keeps discoverable lookups', async () => {
        mount();
        openDetails();
        await screen.findByRole('button', { name: 'Copy creator address' });

        expect(screen.queryByRole('button', { name: 'About' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Media' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Gated content' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Holders' })).toBeTruthy();
    });

    it('renders the explorer amount and copies the complete holder address', async () => {
        mount({ holders: { data: [{ address: HOLDER, amount: '12345.5' }] } });

        openMore('Holders');

        const list = await screen.findByRole('list', { name: 'Holder balances' });
        const row = within(list).getByRole('listitem');
        expect(within(row).getByText('12,345.5')).toBeTruthy();
        fireEvent.click(within(row).getByRole('button', { name: 'Copy holder address 1' }));
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(HOLDER));
    });

    it('keeps History as its own tab while details and holders share the row primitive', async () => {
        mount({
            holders: { data: [{ address: HOLDER, amount: '7' }] },
        });

        const historyTab = screen.getByRole('tab', { name: 'History' });
        expect(historyTab).toBeTruthy();
        openDetails();

        const detailList = await screen.findByRole('list', { name: 'Token detail fields' });
        const detailRow = within(detailList).getAllByRole('listitem')[0].firstElementChild;

        openMore('Holders');
        const holderList = await screen.findByRole('list', { name: 'Holder balances' });
        const holderRow = within(holderList).getByRole('listitem').firstElementChild;

        const sharedRowClass = detailRow.classList[0];
        expect(historyTab).not.toHaveClass(sharedRowClass);
        expect(holderRow).toHaveClass(sharedRowClass);
    });

    it('distinguishes an empty list from a failed holder lookup', async () => {
        mount();
        openMore('Holders');
        expect(await screen.findByText('No holders yet')).toBeTruthy();

        cleanup();
        __clearTokenInfoCache();
        mount({ holdersError: new Error('explorer offline') });
        openMore('Holders');
        expect(await screen.findByText(/couldn't load the holders/i)).toBeTruthy();
        expect(screen.queryByText('No holders yet')).toBeNull();
    });

    it('bounds a holder response with thousands of rows and expands without moving the page', async () => {
        const data = Array.from({ length: 5_000 }, (_, index) => ({
            address: `bcrt1qholder${String(index).padStart(5, '0')}xxxxxxxxxxxxxxxxxxxx`,
            amount: String(index + 1),
        }));
        mount({ holders: { data, total: data.length } });
        openMore('Holders');

        await screen.findByText('Holders (5000)');
        const list = screen.getByRole('list', { name: 'Holder balances' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(100);
        expect(screen.getByRole('button', { name: 'Show More Holders (100 of 5,000 Shown)' })).toBeInTheDocument();

        const scroller = document.querySelector('main');
        scroller.scrollTop = 197;
        const showMore = screen.getByRole('button', { name: 'Show More Holders (100 of 5,000 Shown)' });
        showMore.focus();
        expect(document.activeElement).toBe(showMore);
        fireEvent.click(showMore);

        await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(200));
        expect(scroller.scrollTop).toBe(197);
    });

    it('copies the complete creator address from Details', async () => {
        mount();
        openDetails();
        const copy = await screen.findByRole('button', { name: 'Copy creator address' });
        fireEvent.click(copy);
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CREATOR));
    });

    it('renders dashes for holder rows with missing or non-numeric data', async () => {
        mount({
            holders: {
                data: [
                    { address: null, amount: undefined },
                    { address: 'undefined', quantity: 'NaN' },
                ],
            },
        });

        openMore('Holders');
        const table = await screen.findByRole('list', { name: 'Holder balances' });
        expect(within(table).getAllByText('-', { exact: true })).toHaveLength(4);
        expect(table.textContent).not.toMatch(/undefined|NaN/);
    });

    it('contains synchronous metadata and holder bridge failures', async () => {
        const getTokenInfo = vi.fn(() => { throw new Error('metadata bridge unavailable'); });
        const getHoldersForToken = vi.fn(() => { throw new Error('holders bridge unavailable'); });
        mount({ tokenInfoLookup: getTokenInfo, holdersLookup: getHoldersForToken });

        await waitFor(() => expect(getTokenInfo).toHaveBeenCalled());
        openMore('Holders');
        expect(await screen.findByText(/couldn't load the holders/i)).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: 'Actions' }));
        expect(screen.getByRole('group', { name: 'Actions for DETAILPROBE' })).toBeTruthy();
    });

    it('discards holder pagination and revealed panel state when the token changes', async () => {
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
        openMore('Holders');
        await screen.findByText('Holders (25 of 50)');
        fireEvent.click(screen.getByRole('button', { name: 'Load More Holders' }));

        view.rerender(tree('NEW'));
        expect(screen.queryByRole('list', { name: 'Holder balances' })).toBeNull();
        openMore('Holders');
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
        openMore('Gated content');
        fireEvent.click(await screen.findByRole('button', { name: 'Unlock and open secret.txt' }));
        await waitFor(() => expect(unlockGatedContent).toHaveBeenCalledWith(expect.objectContaining({ chainId: CHAIN, gateTicker: 'OLD' })));

        view.rerender(tree(secondChain, 'NEW'));
        openMore('Gated content');
        fireEvent.click(await screen.findByRole('button', { name: 'Unlock and open secret.txt' }));
        await waitFor(() => expect(unlockGatedContent).toHaveBeenCalledTimes(2));
        expect(unlockGatedContent).toHaveBeenLastCalledWith(expect.objectContaining({
            chainId: secondChain,
            gateTicker: 'NEW',
        }));
    });
});

describe('TokenDetail actions', () => {
    it('renders Send, Receive and Exchange tiles in order and invokes the routes', async () => {
        const onSend = vi.fn();
        const onReceive = vi.fn();
        const onBuy = vi.fn();
        mount({ props: { onSend, onReceive, onBuy } });

        await screen.findByRole('button', { name: 'Send' });
        const actions = within(screen.getByRole('group', { name: 'Actions for DETAILPROBE' }))
            .getAllByRole('button');
        expect(actions.slice(0, 3).map((button) => button.getAttribute('aria-label') || button.textContent)).toEqual([
            'Send',
            'Receive',
            'Exchange',
        ]);

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
        fireEvent.click(screen.getByRole('button', { name: 'Exchange' }));
        expect(onSend).toHaveBeenCalledTimes(1);
        expect(onReceive).toHaveBeenCalledTimes(1);
        expect(onBuy).toHaveBeenCalledTimes(1);
    });

    it('disables Send in watch-only mode while retaining the other action tiles', async () => {
        publishWalletModes({ wallets: [{ id: 'wallet', walletMode: 'watcher' }], activeWalletId: 'wallet' });
        const onSend = vi.fn();
        mount({ props: { onSend, onReceive: vi.fn(), onBuy: vi.fn() } });

        const send = await screen.findByRole('button', { name: 'Send' });
        expect(send).toBeDisabled();
        expect(screen.getByText("This wallet is watch-only and can't sign. Send from its paired signer.")).toBeTruthy();
        fireEvent.click(send);
        expect(onSend).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Receive' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Exchange' })).toBeEnabled();
    });

    it('reads the mode of the wallet on screen: a full wallet signs, a watch-only one cannot', async () => {
        publishWalletModes({
            wallets: [{ id: 'full-wallet', walletMode: 'full' }, { id: 'watch-wallet', walletMode: 'watcher' }],
            activeWalletId: 'full-wallet',
        });
        const onSend = vi.fn();
        const onCreateDispenser = vi.fn();
        const onBrowseDispensers = vi.fn();
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({}),
            getTokenInfo: vi.fn().mockResolvedValue({ creator: CREATOR }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory: vi.fn().mockResolvedValue([]),
        };
        const tree = (walletId) => (
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId={walletId}
                    chainId={CHAIN}
                    tick="DETAILPROBE"
                    kind="token"
                    quantity="10"
                    divisibility={0}
                    onBack={() => {}}
                    onSend={onSend}
                    onReceive={vi.fn()}
                    assetActions={{ onCreateDispenser, onBrowseDispensers }}
                />
            </MessagingProvider>
        );
        const view = render(tree('full-wallet'));

        const fullSend = await screen.findByRole('button', { name: 'Send' });
        await waitFor(() => expect(fullSend).toBeEnabled());
        fireEvent.click(fullSend);
        expect(onSend).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Create dispenser' })).toBeEnabled();

        act(() => { publishWalletModes({ activeWalletId: 'watch-wallet' }); });
        view.rerender(tree('watch-wallet'));

        const watchSend = await screen.findByRole('button', { name: 'Send' });
        await waitFor(() => expect(watchSend).toBeDisabled());
        fireEvent.click(watchSend);
        expect(onSend).toHaveBeenCalledTimes(1);
        expect(screen.getByText("This wallet is watch-only and can't sign. Send from its paired signer.")).toBeTruthy();
        const dispenser = screen.getByRole('button', { name: 'Create dispenser' });
        expect(dispenser).toBeDisabled();
        fireEvent.click(dispenser);
        expect(onCreateDispenser).not.toHaveBeenCalled();
        expect(screen.getByText(/Create dispenser: needs a wallet that can sign; this one is watch-only\./)).toBeTruthy();
        // Looking up dispensers signs nothing, so it stays open.
        expect(screen.getByRole('button', { name: 'Browse dispensers' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Receive' })).toBeEnabled();
    });

    it('locks Send the moment the same wallet turns watch-only', async () => {
        publishWalletModes({ wallets: [{ id: 'wallet', walletMode: 'full' }], activeWalletId: 'wallet' });
        mount({ props: { onSend: vi.fn() } });

        const send = await screen.findByRole('button', { name: 'Send' });
        await waitFor(() => expect(send).toBeEnabled());
        act(() => { publishWalletModes({ wallets: [{ id: 'wallet', walletMode: 'watcher' }], activeWalletId: 'wallet' }); });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled());
    });

    it('keeps a zero-balance Send visible and shows why it is disabled', async () => {
        mount({ props: { quantity: '0', onSend: vi.fn() } });

        const send = await screen.findByRole('button', { name: 'Send' });
        expect(send.disabled).toBe(true);
        expect(screen.getByText('No balance to send.')).toBeTruthy();
    });
});
