// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const address = (id, chain) => ({
    id,
    address: `${chain}-address`,
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

afterEach(cleanup);

describe('LinkForm error banner', () => {
    it('states a rejected action number once, not once for the live check and once for Review', async () => {
        const btc = address('btc-1', BTC);
        const ltc = address('ltc-1', LTC);
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc], [LTC]: [ltc] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc, [LTC]: ltc }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getActionByIndex: vi.fn(({ chainId }) => (chainId === BTC
                ? Promise.reject(new Error('Explorer returned HTTP 500 for /BTC/api/action/10'))
                : Promise.resolve({ action: 'SEND', tick: 'TOKEN', amount: '1' }))),
            buildActionPsbtRequest: vi.fn(),
        };

        render(
            <MessagingProvider shell="web" messaging={client}>
                <LinkForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const inputs = await screen.findAllByLabelText('Action to reference');
        fireEvent.change(inputs[0], { target: { value: '10' } });
        fireEvent.change(inputs[1], { target: { value: '20' } });
        await waitFor(() => expect(screen.getByRole('alert'))
            .toHaveTextContent('Could not verify the action on the network A'));
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(screen.getAllByText(/Could not verify the action on the network A/)).toHaveLength(1);
    });
});
