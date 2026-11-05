// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every state of the Stake screen lays out through the FormPage template:
// the address-load error leads the page as FormPage's status, the loading
// line and the broadcast result sit inside the form, and the unsigned and
// queued result screens render inside a FormPage too. None of them draws
// straight into the bare Screen.
//
// Queries go through `container`: this form renders a large tree, and a
// failed role lookup spends minutes building testing-library's role dump.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const confirmResult = { current: null, calls: 0 };

vi.mock('../../../packages/core/src/shared/hooks/useConfirmAction.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useConfirmAction: () => ({
            confirm: async () => { confirmResult.calls += 1; return confirmResult.current; },
            approve() {},
            reject() {},
            acknowledge() {},
            phase: 'idle',
            composing: false,
            composed: null,
            report: null,
            error: null,
            acknowledged: new Set(),
            source: null,
            canApprove: false,
        }),
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const PUBKEY = 'a'.repeat(64);

function mountStake({ getAddressesByChain } = {}) {
    const target = {
        getAddressesByChain: getAddressesByChain || vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        getStakesForAddress: () => Promise.resolve([]),
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
            <StakeForm walletId="w" chainId={CHAIN} onBack={() => {}} />
        </MessagingProvider>,
    );
    return container;
}

/** The element whose text matches, searched among the given tags. */
function byText(container, selector, text) {
    return Array.from(container.querySelectorAll(selector)).find((node) => node.textContent.includes(text)) || null;
}

async function fillAndSubmit(container) {
    await waitFor(() => {
        const button = container.querySelector('button[type="submit"]');
        expect(button).not.toBeNull();
        expect(button.disabled).toBe(false);
    });
    const labelFor = (text) => {
        const label = byText(container, 'label', text);
        return label ? container.querySelector(`#${CSS.escape(label.getAttribute('for'))}`) : null;
    };
    fireEvent.change(labelFor('Amount'), { target: { value: '25' } });
    fireEvent.change(labelFor('Signing public key'), { target: { value: PUBKEY } });
    fireEvent.click(container.querySelector('button[type="submit"]'));
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    confirmResult.current = null;
    confirmResult.calls = 0;
});

describe('StakeForm lays out every page state through FormPage', () => {
    it('shows the address-load error as the FormPage status', async () => {
        const container = mountStake({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        await waitFor(() => expect(container.querySelector('[data-form-status]')).not.toBeNull());
        expect(container.querySelector('[data-form-status]').textContent).toContain('Address store unavailable');
        expect(container.querySelector('form')).not.toBeNull();
    });

    it('puts the loading line inside the FormPage form', () => {
        const container = mountStake({ getAddressesByChain: () => new Promise(() => {}) });
        const loading = byText(container, 'p', 'Loading addresses');
        expect(loading).not.toBeNull();
        expect(loading.closest('form')).not.toBeNull();
    });

    it('puts the broadcast result and its Done action inside the FormPage form', async () => {
        confirmResult.current = { txid: 'stake-txid' };
        const container = mountStake();
        await fillAndSubmit(container);
        await waitFor(() => expect(container.textContent).toContain('Stake broadcast'));
        expect(confirmResult.calls).toBe(1);
        const summary = byText(container, 'p', 'Stake broadcast');
        const form = summary.closest('form');
        expect(form).not.toBeNull();
        expect(form.textContent).toContain('stake-txid');
        expect(byText(form, 'button', 'Done')).not.toBeNull();
    });

    it.each([
        ['an unsigned PSBT', { psbtHex: '70736274ff' }],
        ['queued for broadcast', { queued: true, txid: 'queued-txid' }],
    ])('renders the result screen for %s inside a FormPage form', async (_label, result) => {
        confirmResult.current = result;
        const container = mountStake();
        await fillAndSubmit(container);
        await waitFor(() => expect(container.querySelector('[data-testid="result-screen-notice"]')).not.toBeNull());
        expect(container.querySelector('[data-testid="result-screen-notice"]').closest('form')).not.toBeNull();
    });
});
