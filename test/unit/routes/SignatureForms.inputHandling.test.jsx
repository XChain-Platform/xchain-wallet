// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SignMessageForm } from '../../../packages/core/src/shared/routes/SignMessageForm.jsx';
import {
    normalizeSignatureInput,
    VerifySignatureForm,
} from '../../../packages/core/src/shared/routes/VerifySignatureForm.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const ADDRESSES = Object.freeze({
    [BTC]: [
        { id: 'btc', address: 'bc1qexample', source: 'hd', label: 'Savings' },
        { id: 'btc-spending', address: 'bc1qspending', source: 'hd', label: 'Spending' },
    ],
    [LTC]: [{ id: 'ltc', address: 'ltc1qexample', source: 'hd' }],
});

function messagingFor(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        verifyMessageRequest: vi.fn().mockResolvedValue({ valid: true }),
        ...overrides,
    };
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function renderForm(Form, messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Form walletId="wallet" onBack={() => {}} />
        </MessagingProvider>,
    );
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function pickLitecoinMainnet() {
    const option = screen.getAllByRole('option', { name: /Litecoin/ })
        .find((item) => !/testnet|regtest/i.test(item.textContent || ''));
    expect(option).toBeTruthy();
    fireEvent.click(option);
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('message signing inputs', () => {
    it('labels the address choices and updates the selection with the signing chain', async () => {
        renderForm(SignMessageForm, messagingFor());
        await screen.findByRole('option', { name: 'Savings: bc1qexample' });
        expect(screen.getByRole('option', { name: 'Spending: bc1qspending' })).toBeTruthy();
        const picker = await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.click(picker);
        pickLitecoinMainnet();

        await waitFor(() => expect(screen.getByLabelText('Address').value).toBe('ltc'));
        expect(screen.getByRole('button', { name: /Chain: Litecoin/ })).toBeTruthy();
    });
});

describe('signature verification inputs and results', () => {
    it('names each required input beside the disabled verify action', async () => {
        renderForm(VerifySignatureForm, messagingFor());
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        const action = screen.getByRole('button', { name: 'Verify signature' });

        expect(action).toBeDisabled();
        expect(action).toHaveAttribute('aria-describedby', 'verify-signature-disabled-reason');
        expect(screen.getByRole('status')).toHaveTextContent('Enter the signer address to continue.');

        fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'bc1qcounterparty' } });
        expect(screen.getByRole('status')).toHaveTextContent('Enter the original message to continue.');

        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'message' } });
        expect(screen.getByRole('status')).toHaveTextContent('Enter the signature to continue.');

        fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'c2lnbmF0dXJl' } });
        expect(action).toBeEnabled();
        expect(action).not.toHaveAttribute('aria-describedby');
    });

    it('accepts wrapped base64 and verifies against the selected chain', async () => {
        const verifyMessageRequest = vi.fn().mockResolvedValue({ valid: true });
        renderForm(VerifySignatureForm, messagingFor({ verifyMessageRequest }));
        const picker = await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.click(picker);
        pickLitecoinMainnet();
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'ltc1qcounterparty' } });
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'exact message\nsecond line' } });
        fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'c2ln\nbmF0dXJl' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verify signature' }));

        await waitFor(() => expect(verifyMessageRequest).toHaveBeenCalledWith({
            chainId: LTC,
            address: 'ltc1qcounterparty',
            message: 'exact message\nsecond line',
            signature: 'c2lnbmF0dXJl',
        }));
        expect(screen.getByRole('status').textContent)
            .toBe('Valid signature. Signature matches this message and address.');
    });

    it('rejects malformed base64 before calling the verifier', async () => {
        const verifyMessageRequest = vi.fn();
        renderForm(VerifySignatureForm, messagingFor({ verifyMessageRequest }));
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'bc1qcounterparty' } });
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'message' } });
        fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'not base64!' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verify signature' }));

        expect(screen.getByRole('status').textContent)
            .toBe('Malformed signature. Enter a base64-encoded signature.');
        expect(verifyMessageRequest).not.toHaveBeenCalled();
    });

    it('words a failed match in terms of both the message and address', async () => {
        renderForm(VerifySignatureForm, messagingFor({
            verifyMessageRequest: vi.fn().mockResolvedValue({ valid: false }),
        }));
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'bc1qcounterparty' } });
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'message' } });
        fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'c2lnbmF0dXJl' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verify signature' }));

        await waitFor(() => expect(screen.getByRole('status').textContent)
            .toBe("Invalid signature. Signature doesn't match this message and address."));
    });

    it('does not show a pending result after an input changes', async () => {
        const pending = deferred();
        const verifyMessageRequest = vi.fn()
            .mockImplementationOnce(() => pending.promise)
            .mockResolvedValueOnce({ valid: false });
        renderForm(VerifySignatureForm, messagingFor({ verifyMessageRequest }));
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'bc1qcounterparty' } });
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'older message' } });
        fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'c2lnbmF0dXJl' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verify signature' }));

        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'newer message' } });
        pending.resolve({ valid: true });

        await waitFor(() => expect(screen.getByRole('button', { name: 'Verify signature' })).not.toBeDisabled());
        expect(screen.queryByText(/Valid signature/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Verify signature' }));
        await waitFor(() => expect(screen.getByRole('status').textContent)
            .toBe("Invalid signature. Signature doesn't match this message and address."));
        expect(verifyMessageRequest).toHaveBeenLastCalledWith(expect.objectContaining({
            message: 'newer message',
        }));
    });

    it('normalizes valid base64 without accepting arbitrary text', () => {
        expect(normalizeSignatureInput(' c2ln\nbmF0dXJl ')).toBe('c2lnbmF0dXJl');
        expect(normalizeSignatureInput('not base64!')).toBe(null);
    });
});
