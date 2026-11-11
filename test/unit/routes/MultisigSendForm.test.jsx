// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const startMultisigSend = vi.fn();
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: { startMultisigSend } }),
}));

const { MultisigSendForm } = await import(
    '../../../packages/core/src/shared/routes/MultisigSendForm.jsx');

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

it('submits typed native amount and fee rate, then opens the new session', async () => {
    startMultisigSend.mockResolvedValue({ id: 'session-9' });
    const onSessionStarted = vi.fn();
    render(
        <MultisigSendForm
            walletId="wallet-1"
            chainId="bitcoin-mainnet"
            multisigConfigId="config-1"
            multisig={{
                multisigConfigId: 'config-1',
                address: 'bc1qmultisig',
                scheme: 'p2wsh-multisig',
                threshold: 2,
                cosignerCount: 3,
            }}
            onSessionStarted={onSessionStarted}
        />,
    );

    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'bc1qdestination' } });
    fireEvent.change(screen.getByLabelText('Amount (BTC)'), { target: { value: '0.001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start signing' }));

    await waitFor(() => expect(startMultisigSend).toHaveBeenCalledWith({
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        multisigConfigId: 'config-1',
        destination: 'bc1qdestination',
        amountSats: '100000',
        feeRate: 6,
    }));
    expect(onSessionStarted).toHaveBeenCalledWith('session-9');
});

it('shows the Taproot limitation and disables starting', () => {
    render(
        <MultisigSendForm
            walletId="wallet-1"
            chainId="bitcoin-mainnet"
            multisigConfigId="config-1"
            multisig={{
                multisigConfigId: 'config-1',
                address: 'bc1ptaproot',
                scheme: 'taproot-musig2',
                threshold: 2,
                cosignerCount: 3,
            }}
        />,
    );

    expect(screen.getByText('Sending from a Taproot multisig is not available yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start signing' })).toBeDisabled();
});

