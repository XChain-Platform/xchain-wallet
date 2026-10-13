// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';

function signerRecord(overrides = {}) {
    return {
        id: 'signer-1',
        walletId: 'wallet-1',
        kind: 'ledger',
        vendor: 'ledger',
        model: 'nanoS',
        deviceIdentifier: 'device-1',
        firmwareVersion: '2.1.0',
        label: 'Desk Ledger',
        ...overrides,
    };
}

function messaging(overrides = {}) {
    return {
        listSigners: vi.fn().mockResolvedValue([]),
        registerSigner: vi.fn(async (record) => signerRecord(record)),
        unregisterSigner: vi.fn().mockResolvedValue({ deleted: true }),
        ...overrides,
    };
}

function mount({ messaging: api = messaging(), pairTrezor, pairLedger, ...props } = {}) {
    return render(
        <MessagingProvider shell="web" messaging={api}>
            <PairSignerForm
                walletId="wallet-1"
                pairTrezor={pairTrezor || vi.fn()}
                pairLedger={pairLedger || vi.fn()}
                onBack={vi.fn()}
                {...props}
            />
        </MessagingProvider>,
    );
}

beforeEach(() => {
    Object.defineProperty(navigator, 'hid', { configurable: true, value: {} });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'hid');
});

describe('PairSignerForm hardware guidance', () => {
    it.each([
        ['device not found', new Error('No device selected'), /No Trezor was found\. Connect and unlock the device, then try again\./],
        ['user rejected', new Error('User rejected the request'), /Pairing was canceled\. Approve the connection on your Trezor and in any browser prompt, then try again\./],
        ['firmware too old', new Error('Device firmware is too old'), /firmware is too old\. Update it with Trezor Suite, reconnect the device, then try again\./],
    ])('gives plain advice when %s', async (_name, failure, expected) => {
        mount({ pairTrezor: vi.fn().mockRejectedValue(failure) });

        fireEvent.click(screen.getByRole('button', { name: /Trezor/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent(expected);
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('explains how to recover when the wrong Ledger app is open', async () => {
        mount({ pairLedger: vi.fn().mockRejectedValue(new Error('UNKNOWN_ERROR (0x6a82)')) });

        fireEvent.click(screen.getByRole('button', { name: /Ledger/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The Bitcoin app is not open on your Ledger. Open the Bitcoin app on the device, then try again.',
        );
    });

    it('blocks old firmware with vendor-specific update advice', async () => {
        const pairLedger = vi.fn().mockResolvedValue({
            signer: { signPsbt: vi.fn() },
            pairingInfo: {
                vendor: 'ledger',
                model: 'nanoS',
                deviceIdentifier: 'device-1',
                firmwareVersion: '1.9.0',
            },
        });
        mount({ pairLedger });

        fireEvent.click(screen.getByRole('button', { name: /Ledger/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            /firmware is too old\. Update it to version 2\.1\.0 or newer with Ledger Live, reconnect the device, then try again\./,
        );
        expect(screen.getByRole('button', { name: 'Update firmware first' })).toBeDisabled();
    });
});

describe('PairSignerForm paired devices', () => {
    it('shows a paired badge and removes the record after unpairing', async () => {
        const record = signerRecord();
        const api = messaging({ listSigners: vi.fn().mockResolvedValue([record]) });
        const onSignerUnpaired = vi.fn();
        mount({ messaging: api, onSignerUnpaired });

        expect(await screen.findByRole('heading', { name: 'Paired devices' })).toBeInTheDocument();
        expect(screen.getByText('Desk Ledger')).toBeInTheDocument();
        expect(screen.getByText('Paired')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Unpair' }));

        await waitFor(() => expect(api.unregisterSigner).toHaveBeenCalledWith('signer-1'));
        await waitFor(() => expect(screen.queryByText('Desk Ledger')).not.toBeInTheDocument());
        expect(onSignerUnpaired).toHaveBeenCalledWith('signer-1');
        expect(screen.getByRole('status')).toHaveTextContent(
            'Desk Ledger unpaired. You can pair it again at any time.',
        );
    });

    it('keeps the paired record visible when unpairing fails', async () => {
        const record = signerRecord();
        const api = messaging({
            listSigners: vi.fn().mockResolvedValue([record]),
            unregisterSigner: vi.fn().mockRejectedValue(new Error('Vault is busy.')),
        });
        mount({ messaging: api });

        fireEvent.click(await screen.findByRole('button', { name: 'Unpair' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Vault is busy.');
        expect(screen.getByText('Desk Ledger')).toBeInTheDocument();
    });
});

const PAIRING_INFO = {
    vendor: 'trezor',
    model: 'test-model',
    deviceIdentifier: 'device-1',
    firmwareVersion: '9.9.9',
};

function mountSimple({ pairTrezor, messaging = {}, onBack = vi.fn(), onPaired } = {}) {
    const props = { walletId: 'wallet-1', pairTrezor, pairLedger: null, onBack, onPaired };
    return {
        onBack,
        ...render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PairSignerForm {...props} />
            </MessagingProvider>,
        ),
    };
}

describe('PairSignerForm pairing flow', () => {
    it('shows each step and persists the edited label', async () => {
        const registerSigner = vi.fn(async () => ({
            ...PAIRING_INFO,
            id: 'signer-1',
            label: 'Travel signer',
        }));
        const pairTrezor = vi.fn(async () => ({ signer: {}, pairingInfo: PAIRING_INFO }));
        mountSimple({ pairTrezor, messaging: { registerSigner } });

        expect(screen.getByText('Step 1 of 4')).toHaveAttribute('aria-current', 'step');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Trezor/ }));
        });
        expect(screen.getByText('Step 3 of 4')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Label'), { target: { value: '  Travel signer  ' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        });
        expect(registerSigner).toHaveBeenCalledWith(expect.objectContaining({
            walletId: 'wallet-1',
            label: 'Travel signer',
        }));
        expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
    });

    it('returns quietly to device choice when the hardware prompt is cancelled', async () => {
        const pairTrezor = vi.fn(async () => {
            throw new Error('Trezor pairing was cancelled or failed');
        });
        mountSimple({ pairTrezor });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Trezor/ }));
        });
        expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByText(/Which kind of device/i)).toBeInTheDocument();
    });

    it('ignores a late hardware result after the user cancels the flow', async () => {
        let finishPairing;
        const pairTrezor = vi.fn(() => new Promise((resolve) => { finishPairing = resolve; }));
        const { onBack } = mountSimple({ pairTrezor });

        fireEvent.click(screen.getByRole('button', { name: /Trezor/ }));
        expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onBack).toHaveBeenCalledOnce();
        expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();

        await act(async () => {
            finishPairing({ signer: {}, pairingInfo: PAIRING_INFO });
        });
        expect(screen.queryByLabelText('Label')).not.toBeInTheDocument();
        expect(screen.getByText(/Which kind of device/i)).toBeInTheDocument();
    });
});
