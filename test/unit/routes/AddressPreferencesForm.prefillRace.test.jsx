// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (xchain-wallet#41) The preferences form prefills its three choices from the
// address's current on-chain values, fetched when the form mounts. On a slow
// explorer read the user can pick new values before that fetch returns, and the
// prefill used to land on top of them: the review then showed every row as
// "(unchanged)" and the ADDRESS write carried the old values. Found by the
// regtest spec addresses/preferences.regtest.spec.js on a loaded rail.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressPreferencesForm } from '../../../packages/core/src/shared/routes/AddressPreferencesForm.jsx';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qprefsprefsprefsprefsprefsprefsprefs00';
const DEFAULTS = { onChain: false, feePreference: 0, requireMemo: 0, dispenserPreference: 1 };

function mountWithSlowPrefill(reviewPreferences = DEFAULTS) {
    let resolvePrefill;
    const prefill = new Promise((resolve) => { resolvePrefill = resolve; });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'a0', address: ADDRESS, publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", source: 'hd' }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'a0', address: ADDRESS } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        // First call is the mount-time prefill, held open; later calls are the
        // review baseline and answer at once.
        getAddressPreferences: vi.fn()
            .mockImplementationOnce(() => prefill)
            .mockResolvedValue(reviewPreferences),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(AddressPreferencesForm, {
            walletId: 'w', chainId: CHAIN, address: ADDRESS, onBack() {},
        }),
    ));
    return { resolvePrefill: (value) => act(async () => { resolvePrefill(value); await prefill; }) };
}

afterEach(() => cleanup());

// The three preferences are pickers whose trigger is named "<field>: <current
// choice>". Incoming Sends and Dispensers start closed, so a section is opened
// before its picker can be queried.
const FEE_FIELD = 'How the protocol fee is handled';
const MEMO_FIELD = 'Require memo on incoming sends';
const DISPENSER_FIELD = 'Who may open dispensers';

async function openSections() {
    await screen.findByRole('button', { name: /^Update preferences$/i });
    for (const title of ['Incoming Sends', 'Dispensers']) {
        const toggle = screen.getByRole('button', { name: new RegExp(`^${title}`) });
        if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
    }
}

function picker(field) {
    return screen.getByRole('button', { name: new RegExp(`^${field}: `) });
}

function chosen(field) {
    return picker(field).getAttribute('aria-label').slice(field.length + 2);
}

function pick(field, option) {
    fireEvent.click(picker(field));
    fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('AddressPreferencesForm keeps choices made before the prefill returns', () => {
    it('a late on-chain read does not overwrite the user\'s picks', async () => {
        const { resolvePrefill } = mountWithSlowPrefill();

        await openSections();
        expect(document.body.textContent).not.toMatch(/regtest|testnet|not mainnet/i);
        pick(FEE_FIELD, 'Destroy (reduces supply)');
        pick(MEMO_FIELD, 'Yes');
        pick(DISPENSER_FIELD, 'Anyone');
        expect(chosen(FEE_FIELD)).toBe('Destroy (reduces supply)');

        await resolvePrefill(DEFAULTS);

        expect(chosen(FEE_FIELD)).toBe('Destroy (reduces supply)');
        expect(chosen(MEMO_FIELD)).toBe('Yes');
        expect(chosen(DISPENSER_FIELD)).toBe('Anyone');
    });

    it('still prefills from chain when the user has not touched the form', async () => {
        const { resolvePrefill } = mountWithSlowPrefill();
        await openSections();
        expect(chosen(FEE_FIELD)).toBe('Donate to protocol development');

        await resolvePrefill({ onChain: true, feePreference: 1, requireMemo: 1, dispenserPreference: 2 });

        expect(chosen(FEE_FIELD)).toBe('Destroy (reduces supply)');
        expect(chosen(MEMO_FIELD)).toBe('Yes');
        expect(chosen(DISPENSER_FIELD)).toBe('Anyone');
    });

    it('refreshes untouched fields at review without replacing a user choice', async () => {
        const fresh = { onChain: true, feePreference: 2, requireMemo: 1, dispenserPreference: 2 };
        const { resolvePrefill } = mountWithSlowPrefill(fresh);
        await openSections();

        await resolvePrefill(DEFAULTS);
        pick(FEE_FIELD, 'Destroy (reduces supply)');
        fireEvent.click(screen.getByRole('button', { name: /^Update preferences$/i }));

        expect(await screen.findByText('Destroy the fee (reduces supply) - CHANGED')).toBeTruthy();
        expect(screen.getByText('Memo required on incoming sends (unchanged)')).toBeTruthy();
        expect(screen.getByText('Anyone may open a dispenser here (unchanged)')).toBeTruthy();
    });

    it('does not let the initial read replace a newer review-time read', async () => {
        const fresh = { onChain: true, feePreference: 1, requireMemo: 1, dispenserPreference: 2 };
        const { resolvePrefill } = mountWithSlowPrefill(fresh);
        await screen.findByRole('button', { name: /^Update preferences$/i });

        fireEvent.click(screen.getByRole('button', { name: /^Update preferences$/i }));
        expect(await screen.findByText('Destroy the fee (reduces supply) (unchanged)')).toBeTruthy();
        await resolvePrefill(DEFAULTS);

        expect(screen.getByText('Destroy the fee (reduces supply) (unchanged)')).toBeTruthy();
        expect(screen.getByText('Memo required on incoming sends (unchanged)')).toBeTruthy();
        expect(screen.getByText('Anyone may open a dispenser here (unchanged)')).toBeTruthy();
    });
});
