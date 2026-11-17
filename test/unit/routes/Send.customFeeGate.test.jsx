// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { typeCustomRate } from '../../helpers/customNetworkFee.js';
import { CHAIN, fillNativeSend, mountSend, sendButton } from './sendInputHarness.jsx';

afterEach(() => cleanup());

// The custom fee is typed into the one editor, the Network fee line (G113).
// A rate with more than 8 decimals cannot be typed there any more (a typed
// fee converts to a rate of 8 places); customFeeReviewStop's own test pins
// that refusal.
describe('Send custom fee gate', () => {
    it.each([
        ['0', /greater than zero/i],
        ['-5', /valid non-negative network fee/i],
        ['abc', /valid non-negative network fee/i],
        ['', /enter a custom network fee/i],
    ])('refuses review with custom fee %j instead of composing with the default fee', async (fee, expected) => {
        const messaging = mountSend();
        await fillNativeSend('0.001');
        // The Fees section starts closed: open it to reach the slider.
        fireEvent.click(screen.getByRole('button', { name: /^Speed and Fees/, expanded: false }));
        await typeCustomRate(fee, { chainId: CHAIN });
        fireEvent.click(sendButton());

        await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(expected));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('composes with the typed rate when the custom fee is valid', async () => {
        const messaging = mountSend();
        await fillNativeSend('0.001');
        // The Fees section starts closed: open it to reach the slider.
        fireEvent.click(screen.getByRole('button', { name: /^Speed and Fees/, expanded: false }));
        await typeCustomRate('12', { chainId: CHAIN });
        fireEvent.click(sendButton());

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
    });
});
