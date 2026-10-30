// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The ADDRESS memo is the last field of a pipe-delimited action line. A memo
// carrying | or ; composes extra fields into the write, so Review refuses it
// with a plain message and the form stays open.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressPreferencesForm } from '../../../packages/core/src/shared/routes/AddressPreferencesForm.jsx';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qprefsprefsprefsprefsprefsprefsprefs00';
const DEFAULTS = { onChain: false, feePreference: 0, requireMemo: 0, dispenserPreference: 1 };

function mountForm() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'a0', address: ADDRESS, publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", source: 'hd' }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'a0', address: ADDRESS } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getAddressPreferences: vi.fn().mockResolvedValue(DEFAULTS),
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
    return target;
}

afterEach(() => cleanup());

describe('AddressPreferencesForm memo delimiters', () => {
    for (const value of ['pay|1', 'a;b', ' x|y;z ']) {
        it(`Review refuses the memo ${JSON.stringify(value)}`, async () => {
            const target = mountForm();
            const memo = await screen.findByLabelText(/^Memo \(optional\)/);
            fireEvent.change(memo, { target: { value } });
            fireEvent.click(screen.getByRole('button', { name: 'Review' }));

            expect(await screen.findByText('Memo cannot contain "|" or ";".')).toBeTruthy();
            expect(screen.queryByRole('form', { name: 'Review preferences' })).toBeNull();
            // Only the mount prefill read runs; Review stops before its baseline read.
            expect(target.getAddressPreferences).toHaveBeenCalledTimes(1);
        });
    }

    it('Review accepts a plain unicode memo and shows it', async () => {
        mountForm();
        const memo = await screen.findByLabelText(/^Memo \(optional\)/);
        fireEvent.change(memo, { target: { value: 'café 🚀' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByRole('form', { name: 'Review preferences' })).toBeTruthy();
        expect(screen.getByText('café 🚀')).toBeTruthy();
    });
});
