// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
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

describe('LinkForm action preview validation', () => {
    it('does not advance when either referenced action cannot be verified', async () => {
        const btc = address('btc-1', BTC);
        const ltc = address('ltc-1', LTC);
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc], [LTC]: [ltc] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc, [LTC]: ltc }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getActionByIndex: vi.fn(({ chainId }) => (chainId === BTC
                ? Promise.reject(new Error('not found'))
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

        expect(await screen.findByRole('button', { name: 'Looking up actions…' })).toBeDisabled();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not verify the action on chain A'));
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(client.buildActionPsbtRequest).not.toHaveBeenCalled();
        expect(screen.queryByText('Review link')).not.toBeInTheDocument();
    });

    it('treats numerically identical action indices as the same action', async () => {
        const btc = address('btc-1', BTC);
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getActionByIndex: vi.fn().mockResolvedValue({ action: 'SEND', tick: 'TOKEN', amount: '1' }),
            buildActionPsbtRequest: vi.fn(),
        };

        render(
            <MessagingProvider shell="web" messaging={client}>
                <LinkForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const inputs = await screen.findAllByLabelText('Action to reference');
        fireEvent.change(inputs[0], { target: { value: '01' } });
        fireEvent.change(inputs[1], { target: { value: '1' } });

        expect(await screen.findByRole('alert')).toHaveTextContent('Cannot link an action to itself');
        expect(client.getActionByIndex).not.toHaveBeenCalled();
    });
});
