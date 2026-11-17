// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The fee control marks an out-of-range custom rate invalid on the field, but
// the form is noValidate, so field validity alone never stops a submit. Left to
// that, a rate above the chain ceiling reaches compose and prices the carrier at
// that rate, and a rate the form cannot price composes at the encoder's own
// default while the field shows the typed one. Sweep refuses both at Review, as
// Send and Create order do. The custom fee is typed into the one editor, the
// Network fee line (G113), as the fee the named rate prices to; a rate of more
// than 8 decimals cannot be typed there any more (customFeeReviewStop's own
// test pins that refusal).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { feeForRate, networkFeeEditor } from '../../helpers/customNetworkFee.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SweepForm } from '../../../packages/core/src/shared/routes/SweepForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const DESTINATION = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const EMPTY_PREVIEW = Object.freeze({
    balances: { rows: [], error: null },
    ownerships: { rows: [], error: null },
    orders: { rows: [], error: null },
    swaps: { rows: [], error: null },
    dispensers: { rows: [], error: null },
    gatedTicks: { rows: [], error: null, partial: false },
});

afterEach(() => cleanup());

async function mountSweep() {
    const composeForConfirm = vi.fn(() => new Promise(() => {}));
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        sweepPreview: () => Promise.resolve(EMPTY_PREVIEW),
        composeForConfirm,
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SweepForm walletId="w" onBack={() => {}} initialChainId={CHAIN} />
        </MessagingProvider>,
    );
    const submit = () => container.querySelector('button[type="submit"]');
    await waitFor(() => {
        expect(submit()).toBeTruthy();
        expect(submit().disabled).toBe(false);
    });
    fireEvent.change(screen.getByLabelText(/^Destination address/), { target: { value: DESTINATION } });
    // The fee selector sits in the standard Fees section, closed on load.
    fireEvent.click(screen.getByRole('button', { name: /^Speed and Fees/ }));
    // Custom opens the Network fee line's one editor.
    fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
    return { container, submit, composeForConfirm };
}

function formAlerts(container) {
    return Array.from(container.querySelectorAll('[role="alert"], [role="status"]'))
        .map((node) => node.textContent).join(' | ');
}

describe('SweepForm custom network fee at Review', () => {
    it('reports a custom rate above the chain ceiling at Review', async () => {
        const q = await mountSweep();
        fireEvent.change(networkFeeEditor(), { target: { value: feeForRate(50000, CHAIN) } });
        fireEvent.click(q.submit());

        await waitFor(() => expect(formAlerts(q.container)).toMatch(/no higher than 1,000/i));
        expect(q.composeForConfirm).toHaveBeenCalledTimes(1);
        expect(q.composeForConfirm.mock.calls[0][0].encoderOpts.feePerKb).toBe(50_000_000);
        // The fee field names the bound; the form status does not repeat it.
        expect(formAlerts(q.container).match(/no higher than 1,000/gi)).toHaveLength(1);
    });

    it('reports an empty custom fee at Review', async () => {
        const q = await mountSweep();
        fireEvent.change(networkFeeEditor(), { target: { value: '' } });
        fireEvent.click(q.submit());

        await waitFor(() => expect(formAlerts(q.container)).toMatch(/enter a custom network fee/i));
        expect(q.composeForConfirm).toHaveBeenCalledTimes(1);
        expect(q.composeForConfirm.mock.calls[0][0].encoderOpts.feePerKb).toBeUndefined();
    });

    it('composes with an in-range custom rate', async () => {
        const q = await mountSweep();
        fireEvent.change(networkFeeEditor(), { target: { value: feeForRate(25, CHAIN) } });
        fireEvent.click(q.submit());

        await waitFor(() => expect(q.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(q.composeForConfirm.mock.calls[0][0].encoderOpts.feePerKb).toBe(25_000);
    });
});
