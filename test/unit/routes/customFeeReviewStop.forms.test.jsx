// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The compose forms are noValidate, so the fee field marking a custom rate
// invalid never stops their submit by itself. Each form runs the shared custom
// fee stop at Review: a rate above the chain ceiling never reaches compose
// (where it would price the carrier at that rate), and a rate the form cannot
// price never composes at the encoder's default while the field shows the
// typed rate. The refusal shows once, under the fee field.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const pickerSelection = vi.hoisted(() => ({ give: 'ALPHA', get: 'BETA' }));

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button
            type="button"
            onClick={() => onSelect({
                chainId: 'bitcoin-mainnet',
                tick: title.includes('give') ? pickerSelection.give : pickerSelection.get,
            })}
        >
            Choose {title}
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DestroyForm } from '../../../packages/core/src/shared/routes/DestroyForm.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function messagingWith(extra = {}) {
    const composeForConfirm = vi.fn(() => new Promise(() => {}));
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getNewestAddress: vi.fn().mockResolvedValue(SOURCE),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 900000 }),
        listContacts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE.address,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: ['ART', 'ALPHA', 'BETA', 'JDOG', 'XCHAIN'].map((tick) => ({
                        tick, quantity: '100', divisibility: 0,
                    })),
                },
            }],
        }),
        getTokenInfo: vi.fn().mockImplementation(({ tick } = {}) => Promise.resolve({
            chainId: CHAIN,
            tick: tick || 'ART',
            divisibility: 0,
            locks: {},
            maxSupply: '5000',
            totalSupply: '1',
            creator: SOURCE.address,
        })),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        composeForConfirm,
        ...extra,
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
    return { messaging, composeForConfirm };
}

function mount(element, messaging) {
    return render(<MessagingProvider shell="web" messaging={messaging}>{element}</MessagingProvider>);
}

async function drain() {
    await act(async () => {
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
}

// Each form: how to mount it, fill it to a valid Review, and press Review.
const FORMS = [
    {
        name: 'Destroy',
        element: <DestroyForm walletId="w" initialChainId={CHAIN} initialTick="ART" initialFromAddress={SOURCE.address} onBack={() => {}} />,
        async fill() {
            fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1' } });
        },
        review: () => screen.getByRole('button', { name: /^Destroy$/ }),
    },
    {
        name: 'Mint',
        element: <MintForm walletId="w" initialChainId={CHAIN} initialTick="ART" onBack={() => {}} />,
        async fill() {
            await screen.findByText(/available to mint/);
            fireEvent.change(await screen.findByLabelText(/^Amount\b/), { target: { value: '10' } });
        },
        review: () => screen.getByRole('button', { name: /^(Mint|Preview)$/ }),
    },
    {
        name: 'Issue',
        element: <IssueTokenForm walletId="w" onBack={() => {}} />,
        // A ticker nobody holds yet.
        messaging: { getTokenInfo: vi.fn().mockResolvedValue(null) },
        async fill(messaging) {
            fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'OWNED' } });
            fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '10' } });
            // Review holds a submit until the ticker availability lookup settles.
            await waitFor(() => expect(messaging.getTokenInfo)
                .toHaveBeenCalledWith(expect.objectContaining({ tick: 'OWNED' })), { timeout: 2000 });
            await drain();
        },
        review: () => screen.getByRole('button', { name: 'Issue token' }),
    },
    {
        name: 'Dispenser',
        element: <DispenserForm walletId="w" initialChainId={CHAIN} initialTick="JDOG" onBack={() => {}} />,
        async fill() {
            await drain();
            fireEvent.change(await screen.findByLabelText(/^Give amount/), { target: { value: '10' } });
            fireEvent.change(screen.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
            fireEvent.change(screen.getByLabelText(/^Trigger price/), { target: { value: '0.01' } });
        },
        review: () => screen.getByRole('button', { name: 'Create' }),
    },
    {
        name: 'Swap',
        element: <SwapForm walletId="w" onBack={() => {}} initialChainId={CHAIN} initialGiveTick="ALPHA" />,
        async fill() {
            await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
            fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
            fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
            fireEvent.change(screen.getByLabelText('Give amount (ALPHA)'), { target: { value: '2' } });
            fireEvent.change(screen.getByLabelText('Get amount (BETA)'), { target: { value: '3' } });
        },
        review: () => screen.getByRole('button', { name: 'Review' }),
    },
    {
        name: 'Stake',
        element: <StakeForm walletId="w" chainId={CHAIN} onBack={() => {}} />,
        async fill() {
            fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1' } });
            fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: 'a'.repeat(64) } });
        },
        review: () => screen.getByRole('button', { name: /^(Stake|Preview)$/ }),
    },
];

async function typeCustomRate(value) {
    fireEvent.change(await screen.findByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/^Custom fee rate/), { target: { value } });
}

function feedbackText() {
    return Array.from(document.querySelectorAll('[role="alert"], [role="status"]'))
        .map((node) => node.textContent).join(' | ');
}

describe.each(FORMS)('$name custom network fee at Review', (form) => {
    it.each([
        ['above the chain ceiling', '50000', /no higher than 1,000/gi],
        ['empty', '', /enter a custom fee rate/gi],
        ['with more than 8 decimals', '5.123456789', /at most 8 decimal places/gi],
    ])('refuses a custom rate %s before compose and names it once', async (_label, rate, message) => {
        const { messaging, composeForConfirm } = messagingWith(form.messaging);
        mount(form.element, messaging);
        await form.fill(messaging);
        await typeCustomRate(rate);
        fireEvent.click(form.review());
        // Long enough for a form that composes to reach compose.
        await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 150); }); });
        await drain();

        expect(composeForConfirm).not.toHaveBeenCalled();
        expect(feedbackText().match(message)).toHaveLength(1);
    });

    it('composes an in-range custom rate at that rate', async () => {
        const { messaging, composeForConfirm } = messagingWith(form.messaging);
        mount(form.element, messaging);
        await form.fill(messaging);
        await typeCustomRate('25');
        fireEvent.click(form.review());

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composeForConfirm.mock.calls[0][0].encoderOpts.feePerKb).toBe(25_000);
    });
});
