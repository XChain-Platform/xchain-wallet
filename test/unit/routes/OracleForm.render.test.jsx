// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qoracleoracleoracleoracleoracleoraclex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(cleanup);

describe('OracleForm rendering', () => {
    it('shows the publishing identity and seeded quote fields', async () => {
        const oracleFeeds = vi.fn().mockResolvedValue([]);
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            oracleFeeds,
            oracleConsumers: vi.fn().mockResolvedValue({ supported: true, dispensers: [] }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <OracleForm
                    walletId="wallet-1"
                    initialChainId={CHAIN}
                    initialTick="price"
                    onBack={vi.fn()}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('heading', { name: 'My oracle' })).toBeInTheDocument();
        expect(screen.getByLabelText("Publishing address (this is your oracle's identity)")).toHaveValue(ADDRESS.address);
        expect(screen.getByLabelText('Token ticker')).toHaveValue('PRICE');
        expect(screen.getByLabelText('Currency')).toHaveValue('USD');
        expect(await screen.findByText(/has not published any prices yet/i)).toBeInTheDocument();
        expect(oracleFeeds).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDRESS.address });
    });
});
