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
// Back, names itself with a heading and shows every coin and token in the same
// value-chart hero; its reads are the selected asset's own, the same whatever
// else the wallet holds.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
beforeEach(() => window.localStorage.setItem('xc:assetBalanceUnit', 'asset'));
afterEach(() => { cleanup(); __clearTokenInfoCache(); });

function messagingFor(tokenInfo, otherHoldings = 0) {
    const tokens = Array.from({ length: otherHoldings }, (_, i) => ({ tick: `OTHER${i}`, quantity: '1', divisibility: 0 }));
    return {
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qcreator', ...tokenInfo }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [{ balances: { tokens } }] }),
    };
}

function mount({ embedded = true, ownerView = false, tick = 'RAREPEPE', displayName = 'Rare Pepe', divisibility = 0, quantity = '1', tokenInfo = {}, messaging } = {}) {
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
                ownerView={ownerView}
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

    it.each([
        ['NFT-like token', { tick: 'BTCNFT', displayName: 'Bitcoin NFT', quantity: '1', supply: '1' }],
        ['stamp token', { tick: 'STAMP', displayName: 'Stamps NFT on Bitcoin', quantity: '847', supply: '847' }],
    ])('keeps the standard hero for a %s on every token surface', async (_label, asset) => {
        for (const surface of [
            { embedded: false, ownerView: false },
            { embedded: true, ownerView: false },
            { embedded: false, ownerView: true },
        ]) {
            const view = mount({
                ...surface,
                tick: asset.tick,
                displayName: asset.displayName,
                quantity: asset.quantity,
                tokenInfo: {
                    divisibility: 0,
                    totalSupply: asset.supply,
                    locks: { max_supply: true },
                },
            });

            const hero = await screen.findByRole('region', { name: asset.displayName });
            expect(hero).toHaveTextContent('Balance');
            expect(hero).toHaveTextContent(asset.quantity);
            expect(document.querySelector('[data-nft-identity]')).toBeNull();

            const chart = await screen.findByRole('region', { name: 'Balance chart' });
            const line = await within(chart).findByRole('img', { name: /^Balance over 1W/ });
            expect(line.getAttribute('aria-label') || line.textContent)
                .toMatch(new RegExp(`Start ${asset.quantity} ${asset.tick}\\. End ${asset.quantity} ${asset.tick}\\.`));
            expect(chart.querySelector('[data-chart-scale="flat"]')).not.toBeNull();
            expect(within(screen.getByRole('tablist', { name: 'Chart range' })).getAllByRole('tab'))
                .toHaveLength(8);

            view.unmount();
            cleanup();
            __clearTokenInfoCache();
        }
    });

    it('keeps the blue card for a token whose supply is not locked', async () => {
        mount({ tokenInfo: { divisibility: 0, totalSupply: '298', locks: { max_supply: false } } });
        await screen.findByRole('heading', { name: 'Rare Pepe' });
        await waitFor(() => expect(screen.getByRole('tab', { name: 'Actions' })).toBeInTheDocument());
        expect(document.querySelector('[data-nft-identity]')).toBeNull();
    });

    it('reads only the selected asset, the same with 3 and 30 other holdings', async () => {
        const counts = [];
        for (const holdings of [3, 30]) {
            const messaging = messagingFor({ divisibility: 0, locks: { max_supply: true } }, holdings);
            const view = mount({ messaging });
            await screen.findByRole('region', { name: 'Balance chart' });
            counts.push(readCount(messaging));
            view.unmount();
            __clearTokenInfoCache();
        }
        expect(counts[0]).toBeGreaterThan(0);
        expect(counts[1]).toBe(counts[0]);
    });
});
