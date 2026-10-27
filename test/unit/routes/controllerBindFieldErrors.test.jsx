// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: a Controller bind field that fails validation is marked invalid and
// tied to its error text, as the other forms do.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

function mount() {
    const messaging = {
        getAddressesByChain: async () => ({
            'litecoin-regtest': [{
                id: 'a1',
                address: 'rltc1qmr46t4ca5wh35k6mczdzrkepqw2d8ne92hnush',
                publicKey: '02aa',
                derivationPath: "m/84'/1'/0'/0/0",
                source: 'hd',
            }],
        }),
        getControllerActionClasses: async () => ({
            actionClasses: ['transfer', 'trade', 'burn', 'mint', 'stake', 'ownership', 'all'],
        }),
        getSignerStatus: async () => ({ status: 'unavailable' }),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ControllerBindForm, { walletId: 'w1', chainId: undefined, tick: undefined, onBack() {} }),
        ),
    );
}

describe('ControllerBindForm field errors', () => {
    it('marks the guard contract invalid and describes it by its error', async () => {
        mount();
        const field = await screen.findByLabelText('Guard contract');
        const submit = document.querySelector('form button[type="submit"]');
        await waitFor(() => expect(submit.disabled).toBe(false));
        fireEvent.click(submit);

        await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
        const ids = field.getAttribute('aria-describedby').split(' ');
        const error = ids.map((id) => document.getElementById(id)).find((el) => /Guard contract is required/.test(el?.textContent || ''));
        expect(error).toBeTruthy();
    });

    it('marks the cooldown invalid when it is not a whole number', async () => {
        mount();
        const guard = await screen.findByLabelText('Guard contract');
        fireEvent.change(guard, { target: { value: '12' } });
        const cooldown = screen.getByLabelText(/Cooldown blocks/);
        fireEvent.change(cooldown, { target: { value: 'x1' } });
        const submit = document.querySelector('form button[type="submit"]');
        await waitFor(() => expect(submit.disabled).toBe(false));
        fireEvent.click(submit);

        await waitFor(() => expect(cooldown).toHaveAttribute('aria-invalid', 'true'));
        expect(guard).not.toHaveAttribute('aria-invalid', 'true');
    });
});
