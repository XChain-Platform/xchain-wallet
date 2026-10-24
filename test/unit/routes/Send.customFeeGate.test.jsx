// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { fillNativeSend, mountSend, sendButton } from './sendInputHarness.jsx';

afterEach(() => cleanup());

describe('Send custom fee gate', () => {
    it.each([
        ['0', /greater than zero/i],
        ['-5', /greater than zero/i],
        ['abc', /greater than zero/i],
        ['1.123456789', /at most 8 decimal places/i],
    ])('refuses review with custom fee rate %j instead of composing with the default fee', async (rate, expected) => {
        const messaging = mountSend();
        await fillNativeSend('0.001');
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: rate } });
        fireEvent.click(sendButton());

        await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(expected));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('composes with the typed rate when the custom fee is valid', async () => {
        const messaging = mountSend();
        await fillNativeSend('0.001');
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: '12' } });
        fireEvent.click(sendButton());

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
    });
});
