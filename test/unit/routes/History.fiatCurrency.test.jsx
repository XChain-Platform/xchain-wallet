// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useFiatRate: () => ({ rate: 10, fiatCurrency: 'EUR' }),
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DetailCard } from '../../../packages/core/src/shared/routes/History.jsx';

afterEach(() => cleanup());

describe('History fiat currency', () => {
    it('formats a native send in the selected currency', async () => {
        const entry = {
            key: 'bitcoin-mainnet:abc',
            chainId: 'bitcoin-mainnet',
            action: 'SEND',
            actionIndex: '12',
            blockIndex: 100,
            txHash: 'abc',
            source: 'bc1qsource',
            raw: { tick: 'BTC', amount: '2' },
        };
        const messaging = {
            listContacts: vi.fn().mockResolvedValue([]),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DetailCard
                    entry={entry}
                    peerCache={{}}
                    chainTip={101}
                    indexerWatermark={101}
                    walletId="wallet"
                    showFiatInHistory
                    fiatCurrency="EUR"
                />
            </MessagingProvider>,
        );

        expect(await screen.findByText(/\(≈ €20\.00\)/)).toBeInTheDocument();
        expect(screen.queryByText(/\$20\.00/)).toBeNull();
    });
});
