// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const PAIRING_INFO = {
    vendor: 'trezor',
    model: 'test-model',
    deviceIdentifier: 'device-1',
    firmwareVersion: '9.9.9',
};

function mount({ pairTrezor, messaging = {}, onBack = vi.fn(), onPaired } = {}) {
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

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('PairSignerForm pairing flow', () => {
    it('shows each step and persists the edited label', async () => {
        const registerSigner = vi.fn(async () => ({
            ...PAIRING_INFO,
            id: 'signer-1',
            label: 'Travel signer',
        }));
        const pairTrezor = vi.fn(async () => ({ signer: {}, pairingInfo: PAIRING_INFO }));
        mount({ pairTrezor, messaging: { registerSigner } });

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
        mount({ pairTrezor });

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
        const { onBack } = mount({ pairTrezor });

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
