// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function mount({ holders = { data: [] }, holdersError = null, props = {} } = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({ creator: CREATOR }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: holdersError
            ? vi.fn().mockRejectedValue(holdersError)
            : vi.fn().mockResolvedValue(holders),
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
});

describe('TokenDetail actions', () => {
    it('renders only actions backed by handlers and invokes their destinations', async () => {
        const onSend = vi.fn();
        const onViewActivity = vi.fn();
        mount({ props: { onSend, onViewActivity } });

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(onSend).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Receive' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Markets' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'History' }));
        expect(onViewActivity).toHaveBeenCalledTimes(1);
    });
});
