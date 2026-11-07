// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The token market panel keeps one placeholder in its price-history slot
// whenever no chart is drawn, so the slot never reads as a blank band,
// including when the token record cannot be read and the panel carries its
// unavailable hint. With no chart the slot stands below the market card at the
// full content width (U15), so the empty state is never a box in the card.

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/flows/demoMode.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isDemoWallet: (id) => id === 'demo-wallet' };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';

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

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function renderToken(walletId, assetInfo, { readFails = false } = {}) {
    const messaging = {
        getTokenInfo: readFails
            ? vi.fn().mockRejectedValue(new Error('explorer unreachable'))
            : vi.fn().mockResolvedValue(assetInfo),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId={walletId}
                chainId={CHAIN}
                tick="SLOTPROBE"
                kind="token"
                quantity="10"
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

function historySlot() {
    return document.querySelector('[class*="marketHistorySlot"]');
}

function inMarketCard(el) {
    return el.closest('[class*="marketCardOffset"]') !== null;
}

async function settledSlot() {
    await vi.waitFor(() => {
        expect(screen.queryByRole('status', { name: 'Loading price history' })).toBeNull();
        expect(historySlot()).not.toBeNull();
    });
    return historySlot();
}

describe('token market history slot', () => {
    it('shows the no-history placeholder beside the hint when the token record cannot be read', async () => {
        renderToken('real-wallet', null, { readFails: true });
        const slot = await settledSlot();
        await vi.waitFor(() => expect(slot.textContent).toContain('Market data is unavailable.'));
        expect(slot.textContent).toContain('No price history yet');
        expect(inMarketCard(slot)).toBe(false);
    });

    it('shows the no-history placeholder when the token record has no market price', async () => {
        renderToken('real-wallet', { creator: 'bcrt1qx' });
        const slot = await settledSlot();
        await vi.waitFor(() => expect(slot.textContent).toContain('No price history yet'));
        expect(slot.textContent).not.toContain('Market data is unavailable.');
        expect(inMarketCard(slot)).toBe(false);
        expect(document.querySelector('[class*="marketCardOffset"]').textContent).toContain('Market cap');
    });

    it('draws the chart and no placeholder when a price series loads', async () => {
        renderToken('demo-wallet', { creator: 'bcrt1qx', marketPrice: '0.5', totalSupply: '1000' });
        expect(await screen.findByRole('img', { name: /^Price trend/ })).toBeTruthy();
        const slot = historySlot();
        expect(slot.querySelector('[aria-label$="price chart"]')).not.toBeNull();
        expect(slot.textContent).not.toContain('No price history yet');
        expect(inMarketCard(slot)).toBe(true);
    });
});
