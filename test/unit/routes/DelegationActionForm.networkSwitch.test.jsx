// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DelegationActionForm } from '../../../packages/core/src/shared/routes/DelegationActionForm.jsx';

const MAIN = 'bitcoin-mainnet';
const TEST = 'bitcoin-testnet';
const MAIN_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const TEST_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const KEY = 'a'.repeat(64);

afterEach(cleanup);

describe('DelegationActionForm revoke prefill across networks', () => {
    it('drops a key it pre-filled for the first network when the user picks another', async () => {
        const getDelegationsForAddress = vi.fn(async ({ address }) => (
            address === MAIN_ADDRESS ? [{ action_index: 1, signing_pubkey: KEY, status: 'valid' }] : []
        ));
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [MAIN]: [{ id: 'm1', address: MAIN_ADDRESS, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
                [TEST]: [{ id: 't1', address: TEST_ADDRESS, publicKey: '02cd', derivationPath: "m/84'/1'/0'/0/0", source: 'hd' }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getDelegationsForAddress,
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
        };
        const messaging = new Proxy(target, {
            get: (object, property) => (property in object ? object[property] : () => Promise.resolve({})),
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DelegationActionForm mode="revoke" walletId="w" chainId={MAIN} onBack={() => {}} />
            </MessagingProvider>,
        );
        const input = await screen.findByLabelText('Signing pubkey to revoke');
        await waitFor(() => expect(input).toHaveValue(KEY));

        fireEvent.click(screen.getByRole('button', { name: /^Network:/ }));
        fireEvent.click((await screen.findAllByRole('option'))[1]);

        await waitFor(() => expect(getDelegationsForAddress).toHaveBeenCalledWith({ chainId: TEST, address: TEST_ADDRESS }));
        await waitFor(() => expect(screen.getByLabelText('Signing pubkey to revoke')).toHaveValue(''));
    });

    it('keeps a key the user typed when the network changes', async () => {
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [MAIN]: [{ id: 'm1', address: MAIN_ADDRESS, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
                [TEST]: [{ id: 't1', address: TEST_ADDRESS, publicKey: '02cd', derivationPath: "m/84'/1'/0'/0/0", source: 'hd' }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getDelegationsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
        };
        const messaging = new Proxy(target, {
            get: (object, property) => (property in object ? object[property] : () => Promise.resolve({})),
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DelegationActionForm mode="revoke" walletId="w" chainId={MAIN} onBack={() => {}} />
            </MessagingProvider>,
        );
        const input = await screen.findByLabelText('Signing pubkey to revoke');
        fireEvent.change(input, { target: { value: KEY } });

        fireEvent.click(screen.getByRole('button', { name: /^Network:/ }));
        fireEvent.click((await screen.findAllByRole('option'))[1]);

        await waitFor(() => expect(target.getDelegationsForAddress).toHaveBeenCalledTimes(2));
        expect(screen.getByLabelText('Signing pubkey to revoke')).toHaveValue(KEY);
    });
});
