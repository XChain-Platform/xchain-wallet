// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { fillNativeSend, mountSend, sendButton } from './sendInputHarness.jsx';

afterEach(() => cleanup());

describe('Send native amount ceiling', () => {
    it.each([
        ['99999999'],
        ['90071993'],
        ['1000000000000000000000'],
    ])('refuses %s BTC before compose instead of reporting an unapproved output', async (amount) => {
        const messaging = mountSend();
        await fillNativeSend(amount);
        fireEvent.submit(sendButton().closest('form'));

        await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/Amount is too large to send/));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
