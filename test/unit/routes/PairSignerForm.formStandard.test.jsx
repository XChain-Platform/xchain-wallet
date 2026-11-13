// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The label-and-save step of pairing on the Wallet Form Standard
// frame: one open Signer section, no From or fee, one action, Back cancels.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const PAIRING_INFO = {
    vendor: 'trezor',
    model: 'test-model',
    deviceIdentifier: 'device-1',
    firmwareVersion: '9.9.9',
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

async function reachConfirm({ registerSigner, onBack = vi.fn() } = {}) {
    const pairTrezor = vi.fn(async () => ({ signer: {}, pairingInfo: PAIRING_INFO }));
    const utils = render(
        <MessagingProvider shell="web" messaging={{ registerSigner }}>
            <PairSignerForm walletId="wallet-1" pairTrezor={pairTrezor} pairLedger={null} onBack={onBack} />
        </MessagingProvider>,
    );
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Trezor/ }));
    });
    return { ...utils, onBack };
}

describe('PairSignerForm confirm step on the Form Standard', () => {
    it('shows one open Signer section, no From or fee, and one success action', async () => {
        const { container } = await reachConfirm({ registerSigner: vi.fn() });

        expect(screen.getByText('Step 3 of 4')).toBeInTheDocument();
        const sections = [...container.querySelectorAll('[data-form-section]')].map((el) => el.getAttribute('data-form-section'));
        expect(sections).toEqual(['signer']);
        expect(screen.getByRole('button', { name: /^Signer/ })).toHaveAttribute('aria-expanded', 'true');
        expect(container.querySelector('[data-form-status]')).not.toBeNull();

        const submitButtons = [...container.querySelectorAll('button[type="submit"]')];
        expect(submitButtons).toHaveLength(1);
        expect(submitButtons[0]).toHaveTextContent(/^Pair signer$/i);
        expect(submitButtons[0]).toHaveClass(buttonStyles.success);
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('saves the trimmed label and cancels through the header Back', async () => {
        const registerSigner = vi.fn(async (record) => ({ ...record, id: 'signer-1', label: 'Travel signer' }));
        await reachConfirm({ registerSigner });

        fireEvent.change(screen.getByLabelText('Label'), { target: { value: '  Travel signer  ' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^Pair signer$/i }));
        });
        expect(registerSigner).toHaveBeenCalledWith(expect.objectContaining({
            walletId: 'wallet-1',
            label: 'Travel signer',
            deviceIdentifier: 'device-1',
        }));
        expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();

        cleanup();
        const { onBack } = await reachConfirm({ registerSigner: vi.fn() });
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        // handleCancel, as the footer Cancel ran it: reset to device choice and leave.
        expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
        expect(onBack).toHaveBeenCalledOnce();
    });
});
