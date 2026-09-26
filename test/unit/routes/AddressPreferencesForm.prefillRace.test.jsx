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

function mountWithSlowPrefill() {
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
            .mockResolvedValue(DEFAULTS),
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

describe('AddressPreferencesForm keeps choices made before the prefill returns', () => {
    it('a late on-chain read does not overwrite the user\'s picks', async () => {
        const { resolvePrefill } = mountWithSlowPrefill();

        const destroy = await screen.findByRole('radio', { name: 'Destroy the fee (reduces supply)' });
        const memo = screen.getByRole('checkbox', { name: 'Require a memo on any send to this address' });
        const openDispensers = screen.getByRole('radio', { name: 'Anyone may open a dispenser funded by this address' });
        fireEvent.click(destroy);
        fireEvent.click(memo);
        fireEvent.click(openDispensers);
        expect(destroy.checked).toBe(true);

        await resolvePrefill(DEFAULTS);

        expect(destroy.checked).toBe(true);
        expect(memo.checked).toBe(true);
        expect(openDispensers.checked).toBe(true);
    });

    it('still prefills from chain when the user has not touched the form', async () => {
        const { resolvePrefill } = mountWithSlowPrefill();
        const destroy = await screen.findByRole('radio', { name: 'Destroy the fee (reduces supply)' });
        expect(destroy.checked).toBe(false);

        await resolvePrefill({ onChain: true, feePreference: 1, requireMemo: 1, dispenserPreference: 2 });

        expect(destroy.checked).toBe(true);
        expect(screen.getByRole('checkbox', { name: 'Require a memo on any send to this address' }).checked).toBe(true);
        expect(screen.getByRole('radio', { name: 'Anyone may open a dispenser funded by this address' }).checked).toBe(true);
    });
});
