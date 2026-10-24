// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The encoder words two refusals for a developer: a fee rate under the node's
// relay minimum and an amount the inputs cannot cover. Send shows each as a
// plain sentence under the field the person edits to fix it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const LTC = 'litecoin-mainnet';
const LTC_FROM = 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9';
const LTC_TO = 'ltc1qxvenxvenxvenxvenxvenxvenxvenxvenwcpknh';

const rpcError = (reason) => Object.assign(new Error(`Encoder RPC error: ${reason}`), {
    name: 'SDKEncoderError', code: 'ENCODER_RPC_ERROR',
});

function mount(sendError) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [LTC]: [{ id: 'addr-ltc', address: LTC_FROM, publicKey: '02ab', derivationPath: "m/84'/2'/0'/0/0", source: 'hd' }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [LTC]: { id: 'addr-ltc', address: LTC_FROM } }),
        getAddressBalances: vi.fn(async () => ({
            native: { tick: 'LTC', quantity: '100000000', divisibility: 8 }, tokens: [],
        })),
        getSettings: vi.fn().mockResolvedValue({ grace: { testSendThresholdSats: 0 }, activeNetwork: 'mainnet' }),
        updateSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        sendToken: vi.fn().mockRejectedValue(sendError),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(React.createElement(MessagingProvider, { shell: 'web', messaging },
        React.createElement(Send, { walletId: 'w', onBack() {}, prefill: { chainId: LTC } })));
    return messaging;
}

async function approveSend(messaging) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: LTC_TO } });
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '0.01' } });
}

async function submit(messaging) {
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    const approve = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(approve).not.toBeDisabled());
    fireEvent.click(approve);
    await waitFor(() => expect(messaging.sendToken).toHaveBeenCalled());
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe('Send maps encoder refusals onto the field that fixes them', () => {
    it('puts a plain minimum-rate sentence under the fee field', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const messaging = mount(rpcError(
            'feePerKb 500 base units/kB produces fee 83, below the node relay minimum 165 base units for a ~165-byte transaction',
        ));
        await approveSend(messaging);
        fireEvent.change(await screen.findByLabelText('Network fee'), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: '0.5' } });
        await submit(messaging);

        const alert = await screen.findByText(/below the network minimum of 1 sat\/vB/);
        expect(alert.textContent).not.toMatch(/feePerKb|base units|relay minimum/);
        expect(screen.getByLabelText(/Custom fee rate/)).toHaveAttribute('aria-invalid', 'true');
    });

    it('puts the shortfall under the amount field in the coin units', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const messaging = mount(rpcError(
            'insufficient funds: selected inputs total 2000 but 2536 is required (outputs 1546 + fee 990)',
        ));
        await approveSend(messaging);
        await submit(messaging);

        const note = await screen.findByText(/Not enough LTC/);
        expect(note.textContent).toContain('0.00002536 LTC');
        expect(note.textContent).toContain('short by 0.00000536 LTC');
        expect(note.textContent).not.toMatch(/outputs|selected inputs/);
        const amount = screen.getByLabelText(/^Amount \(/);
        const describedBy = (amount.getAttribute('aria-describedby') || '').split(/\s+/);
        expect(describedBy.some((id) => document.getElementById(id)?.contains(note))).toBe(true);
    });
});
