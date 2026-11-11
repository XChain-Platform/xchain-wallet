// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: () => ({
        formatNativeFee: () => '~$0.98',
        formatProtocolFee: () => '~$0.13',
        formatFeeTotal: () => '~$1.11',
    }),
}));

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

afterEach(cleanup);

describe('Fees card live quote', () => {
    it('renders a venue quote in a real list form', async () => {
        const base = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    id: 'address-1',
                    address: SOURCE,
                    publicKey: '02ab',
                    derivationPath: "m/84'/0'/0'/0/0",
                    source: 'hd',
                    signerId: 'signer-1',
                }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', fiatCurrency: 'USD' }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            getTokenInfo: vi.fn().mockResolvedValue(null),
            requoteNativeFee: vi.fn().mockResolvedValue({
                xchainFee: '0.064',
                requiredFeeSats: 197,
            }),
        };
        const messaging = new Proxy(base, {
            get(target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop !== 'string') return undefined;
                const stub = vi.fn().mockResolvedValue(null);
                target[prop] = stub;
                return stub;
            },
        });

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ListCreateForm
                    walletId="wallet-1"
                    chainId={CHAIN}
                    initialType="2"
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        fireEvent.change(await screen.findByLabelText('Addresses'), {
            target: { value: '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs' },
        });

        await waitFor(() => expect(messaging.requoteNativeFee).toHaveBeenCalled(), { timeout: 2000 });
        expect(await screen.findByText('0.064 XCHAIN')).toBeInTheDocument();
        expect(screen.getByText(/\+ 0\.064 XCHAIN/)).toBeInTheDocument();
    });
});
