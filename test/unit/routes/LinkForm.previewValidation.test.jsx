// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
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

// Every case here runs as a watch-only wallet. The mode comes from the wallet
// list, not from settings.
beforeEach(() => {
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
});
afterEach(() => { cleanup(); resetWalletModes(); });

describe('LinkForm action preview validation', () => {
    it('does not advance when either referenced action cannot be verified', async () => {
        const btc = address('btc-1', BTC);
        const ltc = address('ltc-1', LTC);
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc], [LTC]: [ltc] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc, [LTC]: ltc }),
            getSettings: vi.fn().mockResolvedValue({}),
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

        const inputs = await screen.findAllByLabelText('Action number');
        expect(document.body.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
        fireEvent.change(inputs[0], { target: { value: '10' } });
        fireEvent.change(inputs[1], { target: { value: '20' } });

        expect(await screen.findByRole('button', { name: 'Looking Up Actions…' })).toBeDisabled();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not verify Action 1'));
        // The second lookup can still be running when the first one's error
        // shows, so wait for the main action button to become available again.
        // The action label and review title are Title Case.
        fireEvent.click(await screen.findByRole('button', { name: 'Link Actions' }));

        expect(client.buildActionPsbtRequest).not.toHaveBeenCalled();
        expect(screen.queryByText('Review Link')).not.toBeInTheDocument();
    });

    it('treats numerically identical action indices as the same action', async () => {
        const btc = address('btc-1', BTC);
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc }),
            getSettings: vi.fn().mockResolvedValue({}),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getActionByIndex: vi.fn().mockResolvedValue({ action: 'SEND', tick: 'TOKEN', amount: '1' }),
            buildActionPsbtRequest: vi.fn(),
        };

        render(
            <MessagingProvider shell="web" messaging={client}>
                <LinkForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const inputs = await screen.findAllByLabelText('Action number');
        fireEvent.change(inputs[0], { target: { value: '01' } });
        fireEvent.change(inputs[1], { target: { value: '1' } });

        expect(await screen.findByRole('alert')).toHaveTextContent('Cannot link an action to itself');
        expect(client.getActionByIndex).not.toHaveBeenCalled();
    });

    it('returns from review without resubmitting and preserves both action indices', async () => {
        const btc = address('btc-1', BTC);
        const ltc = address('ltc-1', LTC);
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc], [LTC]: [ltc] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc, [LTC]: ltc }),
            getSettings: vi.fn().mockResolvedValue({}),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getActionByIndex: vi.fn().mockResolvedValue({ action: 'SEND', tick: 'TOKEN', amount: '1' }),
        };

        render(
            <MessagingProvider shell="web" messaging={client}>
                <LinkForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const inputs = await screen.findAllByLabelText('Action number');
        fireEvent.change(inputs[0], { target: { value: '10' } });
        fireEvent.change(inputs[1], { target: { value: '20' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Link Actions' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Link Actions' }));

        expect(fireEvent.click(await screen.findByRole('button', { name: 'Back' }))).toBe(false);
        const restored = await screen.findAllByLabelText('Action number');
        expect(restored[0]).toHaveValue('10');
        expect(restored[1]).toHaveValue('20');
        expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });

    it('labels the review previews in plain words and never shows raw action JSON', async () => {
        const btc = address('btc-1', BTC);
        const ltc = address('ltc-1', LTC);
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc], [LTC]: [ltc] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc, [LTC]: ltc }),
            getSettings: vi.fn().mockResolvedValue({}),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getActionByIndex: vi.fn(({ chainId }) => Promise.resolve(chainId === BTC
                ? { action: 'SEND', tick: 'TOKEN', amount: '1' }
                : { tx_hash: 'abc123', block_index: 9 })),
        };

        render(
            <MessagingProvider shell="web" messaging={client}>
                <LinkForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const inputs = await screen.findAllByLabelText('Action number');
        fireEvent.change(inputs[0], { target: { value: '10' } });
        fireEvent.change(inputs[1], { target: { value: '20' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Link Actions' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Link Actions' }));

        expect(await screen.findByText('First action')).toBeInTheDocument();
        expect(screen.getByText('Second action')).toBeInTheDocument();
        expect(screen.getByText('Action details unavailable')).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/Side [AB] decoded|tx_hash/);
    });
});
