// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@xchain-wallet/core', () => ({
    branding: {
        chainIconLargeUrl: (chainId) => `/icons/${chainId}-large.png`,
        chainIconSmallUrl: (chainId) => `/icons/${chainId}-small.png`,
    },
    registry: {
        defaultRegistry: () => ({
            get: (chainId) => (chainId === 'bitcoin-mainnet'
                ? { id: chainId, coin: 'bitcoin', displayName: 'Bitcoin' }
                : undefined),
        }),
    },
}));

vi.mock('../../../packages/core/src/shared/components/BalanceList.jsx', () => ({
    tickerColor: () => 'rgb(12, 34, 56)',
}));

import { TickerIcon } from '../../../packages/core/src/shared/components/TickerIcon.jsx';

afterEach(cleanup);

describe('TickerIcon', () => {
    it('renders the native chain icon and hides a broken image', () => {
        const { container } = render(
            <TickerIcon chainId="bitcoin-mainnet" tick="btc" size={32} />,
        );

        const icon = container.querySelector('img');
        expect(icon).toHaveAttribute('src', '/icons/bitcoin-mainnet-large.png');
        expect(icon).toHaveStyle({ width: '32px', height: '32px' });

        fireEvent.error(icon);
        expect(icon).toHaveStyle({ display: 'none' });
    });

    it('renders a token initial with a scaled chain pip', () => {
        const { container } = render(
            <TickerIcon chainId="bitcoin-mainnet" tick="xcp" size={24} />,
        );

        expect(screen.getByText('X')).toHaveStyle({
            background: 'rgb(12, 34, 56)',
            width: '24px',
            height: '24px',
        });
        const pip = screen.getByTitle('Bitcoin');
        expect(pip).toHaveAttribute('src', '/icons/bitcoin-mainnet-small.png');
        expect(pip).toHaveStyle({ width: '12px', height: '12px' });
        expect(container.querySelectorAll('img')).toHaveLength(1);
    });

    it('uses a safe fallback when the chain and ticker are unknown', () => {
        const { container } = render(<TickerIcon chainId="unknown" tick="" />);

        expect(screen.getByText('?')).toBeInTheDocument();
        expect(container.querySelector('img')).toBeNull();
    });
});
