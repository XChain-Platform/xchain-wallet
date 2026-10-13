// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'source',
    address: 'bc1qsourcesourcesourcesourcesourcesources',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mountForm() {
    const composeForConfirm = vi.fn();
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        composeForConfirm,
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({ rows: [] });
        },
    });
    let utils;
    await act(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DispenserForm
                    walletId="w"
                    initialChainId={CHAIN}
                    initialTick="JDOG"
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
        await drainMicrotasks();
    });
    return { ...utils, composeForConfirm };
}

afterEach(() => cleanup());

describe('DispenserForm numeric validation', () => {
    it('refuses a malformed trigger price before composing', async () => {
        const utils = await mountForm();
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: 'many' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));

        expect(utils.getByRole('alert')).toHaveTextContent('Trigger price must be a positive number.');
        expect(utils.composeForConfirm).not.toHaveBeenCalled();
    });

    it('validates the payment-token ticker before composing', async () => {
        const utils = await mountForm();
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.click(utils.getByLabelText('A token'));
        fireEvent.change(utils.getByLabelText('Payment token'), { target: { value: 'BAD/NAME' } });
        fireEvent.change(utils.getByLabelText('Payment amount (per fill)'), { target: { value: '1' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));

        expect(utils.getByRole('alert')).toHaveTextContent(/Payment token/i);
        expect(utils.composeForConfirm).not.toHaveBeenCalled();
    });
});
