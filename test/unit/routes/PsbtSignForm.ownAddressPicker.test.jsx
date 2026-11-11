// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/routes/AddressList.jsx', () => ({
    AddressList: ({ onPick, networkLocked, pickerUnavailableReason }) => {
        const unavailable = {
            id: 'watch-only',
            address: 'ltc1qwatchonlypicker000000000000000000000',
            source: 'watch',
        };
        const reason = pickerUnavailableReason(unavailable, 'litecoin-mainnet');
        return (
            <div>
                <span data-testid="network-lock">{networkLocked ? 'locked' : 'switchable'}</span>
                <button type="button" disabled={Boolean(reason)}>{reason}</button>
                <button
                    type="button"
                    onClick={() => onPick({
                        id: 'litecoin-signing',
                        address: 'ltc1qsigningpicker0000000000000000000000',
                        publicKey: '02bb',
                        derivationPath: "m/84'/2'/0'/0/0",
                        source: 'hd',
                    }, 'litecoin-mainnet')}
                >
                    Pick Litecoin signer
                </button>
            </div>
        );
    },
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';

const BITCOIN = 'bitcoin-mainnet';
const LITECOIN = 'litecoin-mainnet';
const BTC_ADDRESS = 'bc1qsigningpicker00000000000000000000000';
const LTC_ADDRESS = 'ltc1qsigningpicker0000000000000000000000';
const PSBT = '70736274ff01020304';

function mount() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BITCOIN]: [{
                id: 'bitcoin-signing', address: BTC_ADDRESS, publicKey: '02aa',
                derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
            }],
            [LITECOIN]: [{
                id: 'litecoin-signing', address: LTC_ADDRESS, publicKey: '02bb',
                derivationPath: "m/84'/2'/0'/0/0", source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        parsePsbtRequest: vi.fn().mockResolvedValue({
            decomposed: {
                inputs: [{ address: LTC_ADDRESS, value: 1000, prevTxHash: '00'.repeat(32), prevTxIndex: 0 }],
                outputs: [{ address: 'ltc1qrecipient', value: 990 }],
            },
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [], unknown: [] }),
        signPsbtUserInitiated: vi.fn().mockResolvedValue({ signedPsbtHex: PSBT, txHex: 'aa' }),
    };
    const messaging = new Proxy(target, {
        get(value, key) {
            if (key in value) return value[key];
            const stub = vi.fn().mockResolvedValue({});
            value[key] = stub;
            return stub;
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PsbtSignForm walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return target;
}

afterEach(cleanup);

describe('PsbtSignForm own-address picker', () => {
    it('keeps a cross-network signing address and disables an address that cannot sign', async () => {
        const messaging = mount();
        const field = await screen.findByRole('textbox', { name: 'Signing address' });
        expect(field).toHaveAttribute('readonly');
        expect(field).toHaveAttribute('id', 'psbt-sign-address');
        expect(screen.queryByRole('combobox', { name: 'Signing address' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Choose signing address' }));
        expect(screen.getByTestId('network-lock')).toHaveTextContent('switchable');
        expect(screen.getByRole('button', { name: 'This address cannot sign on this network.' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Pick Litecoin signer' }));

        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Signing address' })).toHaveValue(LTC_ADDRESS));
        expect(screen.getByRole('button', { name: /Network: Litecoin/ })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Unsigned transaction code'), { target: { value: PSBT } });
        await screen.findByTestId('psbt-sign-output');
        fireEvent.click(screen.getByRole('button', { name: 'Sign transaction' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.signPsbtUserInitiated).toHaveBeenCalledWith(expect.objectContaining({
            addressId: 'litecoin-signing',
        })));
    });
});
