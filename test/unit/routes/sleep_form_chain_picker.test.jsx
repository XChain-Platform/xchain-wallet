// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId }) => React.createElement('p', null, `Picker chain: ${chainId}`),
}));

const BITCOIN = 'bitcoin-mainnet';
const LITECOIN = 'litecoin-mainnet';
const BITCOIN_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const LITECOIN_ADDRESS = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

const address = (id, value, coinType) => ({
    id,
    address: value,
    publicKey: `02${id}`,
    derivationPath: `m/84'/${coinType}'/0'/0/0`,
    source: 'hd',
    signerId: 'signer-1',
});

function mountSleepForm(overrides = {}) {
    const addresses = {
        [BITCOIN]: [address('btc', BITCOIN_ADDRESS, 0)],
        [LITECOIN]: [address('ltc', LITECOIN_ADDRESS, 2)],
    };
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 10_000 }),
        sleepAction: vi.fn().mockResolvedValue({ txid: 'sleep-txid' }),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SleepForm
                walletId="wallet-1"
                mode="address"
                initialChainId={BITCOIN}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(cleanup);

describe('SleepForm address lock chain selection', () => {
    it('retargets the locked address and address picker when the network changes', async () => {
        mountSleepForm();

        expect(await screen.findByLabelText('Address to lock')).toHaveValue(BITCOIN_ADDRESS);
        fireEvent.click(await screen.findByRole('button', { name: /^Network:/ }));
        fireEvent.click(await screen.findByRole('option', { name: /^Litecoin/ }));

        await waitFor(() => {
            expect(screen.getByLabelText('Address to lock')).toHaveValue(LITECOIN_ADDRESS);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        expect(await screen.findByText(`Picker chain: ${LITECOIN}`)).toBeInTheDocument();
    });

    it('turns a block duration into the exact wake block shown and signed at review', async () => {
        const messaging = mountSleepForm();

        expect(await screen.findByText(/Duration starts from current block 10,000/)).toBeInTheDocument();
        expect(screen.getByText(/native coins are not locked/i)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Duration (blocks)'), { target: { value: '12' } });
        expect(screen.getByText(/Wake block: 10,012/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByText(/until block 10012/)).toBeInTheDocument();
        expect(screen.getByText('Automatically at block 10,012. The address cannot wake itself early.')).toBeInTheDocument();
        expect(screen.getByText('12 blocks')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        fireEvent.click(screen.getByRole('button', { name: /Lock address on/ }));

        await waitFor(() => {
            expect(messaging.sleepAction).toHaveBeenCalledWith(expect.objectContaining({
                params: { VERSION: '0', RESUME_BLOCK: '10012' },
            }));
        });
    });

    it('explains invalid and unavailable duration errors in user-facing terms', async () => {
        mountSleepForm({ getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }) });

        const duration = await screen.findByLabelText('Duration (blocks)');
        fireEvent.change(duration, { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText('Duration must be at least 1 block.')).toBeInTheDocument();

        fireEvent.change(duration, { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText(/current block is unavailable/)).toBeInTheDocument();
    });

    it('requires a fresh typed confirmation each time address-lock review opens', async () => {
        mountSleepForm();

        const duration = await screen.findByLabelText('Duration (blocks)');
        await screen.findByText(/Duration starts from current block 10,000/);
        fireEvent.change(duration, { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        fireEvent.change(await screen.findByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByLabelText('Type LOCK to confirm')).toHaveValue('');
        expect(screen.getByRole('button', { name: /Lock address on/ })).toBeDisabled();
    });
});
