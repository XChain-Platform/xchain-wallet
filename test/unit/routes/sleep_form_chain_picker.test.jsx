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
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'wake after audit' } });
        expect(screen.getByText(/Wake block: 10,012/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByText(/until block 10012/)).toBeInTheDocument();
        expect(screen.getByText('Automatically at block 10,012. The address cannot wake itself early.')).toBeInTheDocument();
        expect(screen.getByText('12 blocks')).toBeInTheDocument();
        expect(screen.getByText('wake after audit')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        fireEvent.click(screen.getByRole('button', { name: /Lock address on/ }));

        await waitFor(() => {
            expect(messaging.sleepAction).toHaveBeenCalledWith(expect.objectContaining({
                params: { VERSION: '0', RESUME_BLOCK: '10012', MEMO: 'wake after audit' },
            }));
        });
    });

    it('explains every invalid duration shape in user-facing terms', async () => {
        mountSleepForm();

        const duration = await screen.findByLabelText('Duration (blocks)');
        for (const [value, message] of [
            ['', 'Enter a duration in blocks.'],
            ['0', 'Duration must be at least 1 block.'],
            ['-1', 'Duration must be a whole number of blocks.'],
            ['1.5', 'Duration must be a whole number of blocks.'],
            ['9007199254740992', 'Duration is too large. Enter fewer blocks.'],
        ]) {
            fireEvent.change(duration, { target: { value } });
            fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
            expect(await screen.findByText(message)).toBeInTheDocument();
        }
    });

    it('refuses an unavailable fresh height before review', async () => {
        const watermark = vi.fn()
            .mockResolvedValueOnce({ watermark: 10_000 })
            .mockResolvedValueOnce({ watermark: null });
        mountSleepForm({ getIndexerWatermark: watermark });

        const duration = await screen.findByLabelText('Duration (blocks)');
        fireEvent.change(duration, { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText(/current block could not be refreshed/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Lock address' })).toBeInTheDocument();
    });

    it('refreshes the height for review and refuses an expired snapshot', async () => {
        const watermark = vi.fn()
            .mockResolvedValueOnce({ watermark: 10_000 })
            .mockResolvedValueOnce({ watermark: 10_005 })
            .mockResolvedValueOnce({ watermark: 10_017 });
        const messaging = mountSleepForm({ getIndexerWatermark: watermark });

        const duration = await screen.findByLabelText('Duration (blocks)');
        fireEvent.change(duration, { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByText(/until block 10017/)).toBeInTheDocument();
        expect(screen.getByText('10017')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        fireEvent.click(screen.getByRole('button', { name: /Lock address on/ }));

        expect(await screen.findByText('Wake block 10,017 has passed. Go back and choose a new duration.')).toBeInTheDocument();
        expect(messaging.sleepAction).not.toHaveBeenCalled();
    });

    it('refuses malformed source data and an overlong memo before review', async () => {
        const badAddress = address('bad', 'not-an-address', 0);
        mountSleepForm({
            getAddressesByChain: vi.fn().mockResolvedValue({ [BITCOIN]: [badAddress] }),
        });

        await screen.findByLabelText('Address to lock');
        fireEvent.click(screen.getByRole('radio', { name: 'Lock indefinitely (permanent)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText(/selected source address is not valid/i)).toBeInTheDocument();

        cleanup();
        mountSleepForm();
        await screen.findByLabelText('Address to lock');
        fireEvent.click(screen.getByRole('radio', { name: 'Lock indefinitely (permanent)' }));
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'x'.repeat(251) } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText('Memo is 251 bytes; the network accepts at most 250 bytes.')).toBeInTheDocument();
    });

    it('does not review an empty custom network fee rate', async () => {
        mountSleepForm();

        await screen.findByLabelText('Address to lock');
        fireEvent.click(screen.getByRole('radio', { name: 'Lock indefinitely (permanent)' }));
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Network fee' }), { key: 'End' });
        fireEvent.change(await screen.findByLabelText(/Custom fee rate/), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByText('Enter a custom network fee rate greater than zero.')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Lock address' })).toBeInTheDocument();
    });

    it('requires a fresh typed confirmation each time address-lock review opens', async () => {
        mountSleepForm();

        const duration = await screen.findByLabelText('Duration (blocks)');
        await screen.findByText(/Duration starts from current block 10,000/);
        fireEvent.change(duration, { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'keep me' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        fireEvent.change(await screen.findByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByLabelText('Duration (blocks)')).toHaveValue('1');
        expect(screen.getByLabelText('Memo (optional)')).toHaveValue('keep me');
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByLabelText('Type LOCK to confirm')).toHaveValue('');
        expect(screen.getByRole('button', { name: /Lock address on/ })).toBeDisabled();
    });
});
