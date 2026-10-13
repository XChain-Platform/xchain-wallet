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
            get: (chainId) => ({
                'bitcoin-mainnet': {
                    id: chainId, coin: 'bitcoin', displayName: 'Bitcoin',
                },
                'litecoin-mainnet': {
                    id: chainId, coin: 'litecoin', displayName: 'Litecoin',
                },
            })[chainId],
        }),
    },
}));

vi.mock('@xchain-wallet/core/branding/branding.js', () => ({
    chainIconSmallUrl: (chainId) => `/icons/${chainId}-small.png`,
}));

vi.mock('../../../packages/core/src/shared/components/BalanceList.jsx', () => ({
    tickerColor: () => 'rgb(12, 34, 56)',
    isAssetImageSourceAllowed: (url, allowRemoteImages) => Boolean(url && allowRemoteImages),
}));

vi.mock('../../../packages/core/src/shared/hooks/useTokenInfo.js', () => ({
    useTokenInfo: () => null,
}));

import { TickerIcon } from '../../../packages/core/src/shared/components/TickerIcon.jsx';
import { CollectiblesView } from '../../../packages/core/src/shared/components/CollectiblesView.jsx';
import { GatedFileViewer } from '../../../packages/core/src/shared/components/GatedFileViewer.jsx';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('TickerIcon', () => {
    it('falls back from a broken native icon and shows a later source', () => {
        const { container, rerender } = render(
            <TickerIcon chainId="bitcoin-mainnet" tick="btc" size={32} />,
        );

        const icon = container.querySelector('img');
        expect(icon).toHaveAttribute('src', '/icons/bitcoin-mainnet-large.png');
        expect(icon).toHaveStyle({ width: '32px', height: '32px' });

        fireEvent.error(icon);
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('B')).toBeInTheDocument();

        rerender(<TickerIcon chainId="litecoin-mainnet" tick="ltc" size={32} />);
        expect(container.querySelector('img')).toHaveAttribute(
            'src',
            '/icons/litecoin-mainnet-large.png',
        );
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

        fireEvent.error(pip);
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('X')).toBeInTheDocument();
    });

    it('uses a safe fallback when the chain and ticker are unknown', () => {
        const { container } = render(<TickerIcon chainId="unknown" tick="" />);

        expect(screen.getByText('?')).toBeInTheDocument();
        expect(container.querySelector('img')).toBeNull();
    });
});

describe('related image resource cleanup', () => {
    it('removes a collectible chain badge that fails to load', () => {
        const row = {
            chainId: 'bitcoin-mainnet',
            chainDisplayName: 'Bitcoin',
            tick: 'ART',
            kind: 'token',
            displayName: 'Artwork',
            divisibility: 0,
            fiatRate: null,
            quantity: '1',
        };
        const { container } = render(
            <CollectiblesView rows={[row]} allowRemoteImages={false} />,
        );

        const chainBadge = screen.getByTitle('Bitcoin');
        expect(chainBadge).toHaveAttribute('src', '/icons/bitcoin-mainnet-small.png');

        fireEvent.error(chainBadge);
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('AR')).toBeInTheDocument();
    });

    it('revokes preview and download URLs and cancels cleanup on unmount', () => {
        vi.useFakeTimers();
        let nextUrl = 0;
        const createObjectURL = vi.spyOn(URL, 'createObjectURL')
            .mockImplementation(() => `blob:lifecycle-${nextUrl += 1}`);
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
            .mockImplementation(() => {});
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const png = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.from('pixels'),
        ]).toString('base64');
        const { unmount } = render(
            <React.StrictMode>
                <GatedFileViewer
                    name="art.png"
                    declaredType="image/png"
                    plaintextBase64={png}
                    onClose={() => {}}
                />
            </React.StrictMode>,
        );

        expect(screen.getByAltText('art.png')).toHaveAttribute('src', 'blob:lifecycle-2');
        fireEvent.click(screen.getByRole('button', { name: 'Download' }));
        expect(createObjectURL).toHaveBeenCalledTimes(3);

        unmount();
        for (const { value: url } of createObjectURL.mock.results) {
            expect(revokeObjectURL).toHaveBeenCalledWith(url);
        }
        const revokeCount = revokeObjectURL.mock.calls.length;
        vi.runAllTimers();
        expect(revokeObjectURL).toHaveBeenCalledTimes(revokeCount);
    });
});
