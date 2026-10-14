// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('lightweight-charts', () => {
    throw new Error('chart unavailable');
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketChart } from '../../../packages/core/src/shared/components/MarketChart.jsx';

afterEach(() => cleanup());

describe('MarketChart fallback', () => {
    it('shows user-facing fallback copy with a valid theme token', async () => {
        render(
            <MessagingProvider shell="web" messaging={{ getMarketHistory: vi.fn().mockResolvedValue([]) }}>
                <MarketChart chainId="bitcoin-mainnet" tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );

        const fallback = await screen.findByText('The price chart is unavailable right now.');
        expect(fallback.style.color).toBe('var(--xc-text-muted)');
        expect(document.body.textContent).not.toContain('pnpm');
    });
});
