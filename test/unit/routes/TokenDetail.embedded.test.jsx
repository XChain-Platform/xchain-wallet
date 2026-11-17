// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// TokenDetail drawn as wide Home's detail panel (G115, `embedded`): Home's
// Screen is the page, so the panel adds no main landmark, page header or
// Back, names itself with a heading and shows the asset on its card; an NFT
// (0 decimals, locked supply) opens with its outlined identity card (G16)
// instead of the blue card; and its reads are the selected asset's own, the
// same whatever else the wallet holds.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
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
afterEach(() => { cleanup(); __clearTokenInfoCache(); });

function messagingFor(tokenInfo, otherHoldings = 0) {
    const tokens = Array.from({ length: otherHoldings }, (_, i) => ({ tick: `OTHER${i}`, quantity: '1', divisibility: 0 }));
    return {
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qcreator', ...tokenInfo }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [{ balances: { tokens } }] }),
    };
}

function mount({ embedded = true, tick = 'RAREPEPE', displayName = 'Rare Pepe', divisibility = 0, quantity = '1', tokenInfo = {}, messaging } = {}) {
    const m = messaging || messagingFor(tokenInfo);
    const view = render(
        <MessagingProvider shell="web" messaging={m}>
            <TokenDetail
                walletId="w1"
                chainId={CHAIN}
                tick={tick}
                kind="token"
                displayName={displayName}
                divisibility={divisibility}
                quantity={quantity}
                embedded={embedded}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return { ...view, messaging: m };
}

function readCount(messaging) {
    return Object.values(messaging).reduce((sum, fn) => sum + (fn.mock?.calls.length || 0), 0);
}

describe('TokenDetail embedded in wide Home', () => {
    it('adds no main landmark, page header or Back, and names the panel with a heading', async () => {
        mount({ tick: 'XCP', displayName: 'Counterparty', divisibility: 8, quantity: '31000000000' });
        expect(await screen.findByRole('heading', { name: 'Counterparty' })).toBeInTheDocument();
        expect(screen.queryByRole('main')).toBeNull();
        expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
        // The asset's name shows on its card, where the page header would name it.
        expect(document.querySelector('[aria-labelledby]')?.textContent).toContain('Counterparty');
        expect(screen.getByRole('tab', { name: 'Actions' })).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps the page header outside the panel', async () => {
        mount({ embedded: false, tick: 'XCP', displayName: 'Counterparty', divisibility: 8, quantity: '31000000000' });
        expect(await screen.findByRole('main')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 2, name: 'Counterparty' })).toBeNull();
    });

    it('opens an NFT with its identity card, not the blue card', async () => {
        mount({ tokenInfo: { divisibility: 0, totalSupply: '298', locks: { max_supply: true } } });
        await waitFor(() => expect(document.querySelector('[data-nft-identity]')).not.toBeNull());
        const card = screen.getByRole('region', { name: 'Rare Pepe' });
        expect(card).toHaveTextContent('RAREPEPE · NFT on Bitcoin');
        expect(card).toHaveTextContent('You hold 1 of 298.');
        expect(screen.getByRole('tab', { name: 'Actions' })).toBeInTheDocument();
    });

    it('keeps the blue card for a token whose supply is not locked', async () => {
        mount({ tokenInfo: { divisibility: 0, totalSupply: '298', locks: { max_supply: false } } });
        await screen.findByRole('heading', { name: 'Rare Pepe' });
        await waitFor(() => expect(screen.getByRole('tab', { name: 'Actions' })).toBeInTheDocument());
        expect(document.querySelector('[data-nft-identity]')).toBeNull();
    });

    it('keeps the identity card off the coin page itself', async () => {
        mount({ embedded: false, tokenInfo: { divisibility: 0, totalSupply: '298', locks: { max_supply: true } } });
        await screen.findByRole('main');
        await waitFor(() => expect(screen.getByRole('tab', { name: 'Actions' })).toBeInTheDocument());
        expect(document.querySelector('[data-nft-identity]')).toBeNull();
    });

    it('reads only the selected asset, the same with 3 and 30 other holdings', async () => {
        const counts = [];
        for (const holdings of [3, 30]) {
            const messaging = messagingFor({ divisibility: 0, locks: { max_supply: true } }, holdings);
            const view = mount({ messaging });
            await waitFor(() => expect(document.querySelector('[data-nft-identity]')).not.toBeNull());
            counts.push(readCount(messaging));
            view.unmount();
            __clearTokenInfoCache();
        }
        expect(counts[0]).toBeGreaterThan(0);
        expect(counts[1]).toBe(counts[0]);
    });
});
