// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@xchain-wallet/core/shared/routes/MarketsList.jsx', () => ({
    MarketsList: ({ walletId }) => <div>Markets for {walletId}</div>,
}));

import { renderDexRoute } from '../../../packages/web/src/surfaces/dex.jsx';

describe('lazy DEX routes', () => {
    it('renders a selected route after its lazy chunk resolves', async () => {
        const route = renderDexRoute('markets', {
            activeWalletId: 'wallet-1',
            activeAccountId: null,
            marketsAsset: null,
            setMarketsAsset: vi.fn(),
            activeMarket: null,
            setActiveMarket: vi.fn(),
            setUnlockedView: vi.fn(),
            setDispenserRef: vi.fn(),
            formBack: vi.fn(),
        });

        render(<Suspense fallback={<div>Loading route</div>}>{route}</Suspense>);

        expect(screen.getByText('Loading route')).toBeInTheDocument();
        expect(await screen.findByText('Markets for wallet-1')).toBeInTheDocument();
    });
});
