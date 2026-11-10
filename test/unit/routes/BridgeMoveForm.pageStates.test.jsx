// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every state of the bridge move screen lays out through the FormPage
// template: the address-load error leads the page as FormPage's status, the
// loading line sits inside the form, and the unsigned, queued and pending
// results render inside a FormPage too. None of them draws straight into the
// bare Screen body.
//
// Queries go through `container`: this form renders a large tree, and a
// failed role lookup spends minutes building testing-library's role dump.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const confirmResult = { current: null };

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useActionConfirmFlow: () => ({
            run: async () => confirmResult.current,
            open: false,
            composing: false,
            confirmAction: null,
        }),
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BridgeMoveForm } from '../../../packages/core/src/shared/routes/BridgeMoveForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const BTC_ADDRESS = Object.freeze({
    id: 'a-btc', address: 'bc1qdevmock02aa', publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
});
const DOGE_ADDRESS = Object.freeze({
    id: 'a-doge', address: 'Ddevmock02bb', publicKey: '02bb', derivationPath: "m/44'/3'/0'/0/0", source: 'hd',
});
const BY_CHAIN = Object.freeze({ [BTC]: [BTC_ADDRESS], [DOGE]: [DOGE_ADDRESS] });
const WAIT = { timeout: 4000 };

function mountBridge({ getAddressesByChain } = {}) {
    const walletBalances = {};
    for (const [chainId, addrs] of Object.entries(BY_CHAIN)) {
        walletBalances[chainId] = addrs.map((a) => ({
            address: a.address,
            balances: { tokens: [{ tick: 'XCHAIN', quantity: 10e8, divisibility: 8 }] },
        }));
    }
    const target = {
        getAddressesByChain: getAddressesByChain || vi.fn().mockResolvedValue(BY_CHAIN),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: vi.fn().mockImplementation((_w, chainId) => Promise.resolve((BY_CHAIN[chainId] || [])[0] || null)),
        getWalletBalances: vi.fn().mockResolvedValue(walletBalances),
        getTokenInfo: vi.fn().mockResolvedValue(null),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (typeof prop !== 'string') return undefined;
            return () => Promise.resolve(null);
        },
        has: (t, prop) => prop in t,
    });
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BridgeMoveForm walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    return container;
}

/** The element whose text matches, searched among the given tags. */
function byText(container, selector, text) {
    return Array.from(container.querySelectorAll(selector)).find((node) => node.textContent.includes(text)) || null;
}

/** The input whose label text starts with the pattern. */
function inputByLabel(container, pattern) {
    return Array.from(container.querySelectorAll('input')).find((input) => {
        const id = input.getAttribute('id');
        const label = id ? container.querySelector(`label[for="${id}"]`) : null;
        return pattern.test((label?.textContent || '').trim());
    }) || null;
}

async function submitMove(container) {
    await waitFor(() => {
        expect(inputByLabel(container, /^Receive at/)?.value).toBe(DOGE_ADDRESS.address);
    }, WAIT);
    fireEvent.change(inputByLabel(container, /^Amount/i), { target: { value: '1' } });
    const button = byText(container, 'button[type="submit"]', 'Review move');
    await waitFor(() => expect(button.disabled).toBe(false), WAIT);
    fireEvent.click(button);
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    __clearTokenInfoCache();
    confirmResult.current = null;
});

describe('BridgeMoveForm lays out every page state through FormPage', () => {
    it('keeps the editable receiving address and route notice inside the form page', async () => {
        const container = mountBridge();
        await waitFor(() => expect(inputByLabel(container, /^Receive at/)?.value)
            .toBe(DOGE_ADDRESS.address), WAIT);
        const receive = inputByLabel(container, /^Receive at/);
        expect(receive.readOnly).toBe(false);

        fireEvent.change(inputByLabel(container, /^Amount/i), { target: { value: '10' } });
        await waitFor(() => expect(container.textContent).toContain(
            'Locks 10 XCHAIN on Bitcoin and credits it on Dogecoin after 6 confirmations (~60 min).'
            + ' The credit cannot be undone or redirected.',
        ), WAIT);
        expect(byText(container, 'dt', 'Source network')).toBeNull();
        expect(byText(container, 'dt', 'Destination network')).toBeNull();
        expect(byText(container, 'dt', 'Expected arrival')).toBeNull();
        expect(receive.closest('form')).not.toBeNull();
    });

    it('shows the address-load error as the FormPage status', async () => {
        const container = mountBridge({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        await waitFor(() => expect(container.querySelector('[data-form-status]')).not.toBeNull(), WAIT);
        expect(container.querySelector('[data-form-status]').textContent).toContain('Could not load your addresses');
        expect(container.querySelector('form')).not.toBeNull();
    });

    it('puts the loading line inside the FormPage form', () => {
        const container = mountBridge({ getAddressesByChain: () => new Promise(() => {}) });
        const loading = byText(container, 'p', 'Loading wallet');
        expect(loading).not.toBeNull();
        expect(loading.closest('form')).not.toBeNull();
    });

    it('puts the pending panel and its Done action inside the FormPage form', async () => {
        confirmResult.current = { txid: 'bridge-source-txid' };
        const container = mountBridge();
        await submitMove(container);
        await waitFor(() => expect(container.textContent).toContain('bridge-source-txid'), WAIT);
        const form = byText(container, 'code', 'bridge-source-txid').closest('form');
        expect(form).not.toBeNull();
        expect(byText(form, 'p', 'Bridge transfer pending')).not.toBeNull();
        expect(byText(form, 'button', 'Done')).not.toBeNull();
    });

    it.each([
        ['an unsigned PSBT', { psbtHex: '70736274ff' }],
        ['queued for broadcast', { queued: true }],
    ])('renders the result screen for %s inside a FormPage form', async (_label, result) => {
        confirmResult.current = result;
        const container = mountBridge();
        await submitMove(container);
        await waitFor(() => expect(container.querySelector('[data-testid="result-screen-notice"]')).not.toBeNull(), WAIT);
        expect(container.querySelector('[data-testid="result-screen-notice"]').closest('form')).not.toBeNull();
    });
});
