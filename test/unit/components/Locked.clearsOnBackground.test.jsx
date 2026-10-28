// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Typed text never outlives a trip to the background on a native shell: the
// shell dispatches `pause` on the document, and the field comes back empty.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { clearLockoutState } from '../../../packages/core/src/flows/index.js';

beforeEach(() => clearLockoutState());
afterEach(() => {
    cleanup();
    clearLockoutState();
});

function mount() {
    const messaging = {
        unlockWallet: vi.fn(async () => ({})),
        capturePassphrase: vi.fn(async () => ({ stored: true })),
    };
    render(
        <MessagingProvider shell="mobile" messaging={messaging}>
            <Locked onUnlocked={vi.fn()} />
        </MessagingProvider>,
    );
    return messaging;
}

describe('Locked password field on a native background', () => {
    it('empties the typed password when the shell pauses', () => {
        mount();
        const field = screen.getByLabelText('Password');
        fireEvent.change(field, { target: { value: 'typed-before-leaving' } });
        expect(field).toHaveValue('typed-before-leaving');

        act(() => { document.dispatchEvent(new Event('pause')); });

        expect(screen.getByLabelText('Password')).toHaveValue('');
        expect(screen.getByRole('button', { name: /unlock wallet/i })).toBeDisabled();
    });

    it('keeps the typed password when the page only loses focus', () => {
        mount();
        const field = screen.getByLabelText('Password');
        fireEvent.change(field, { target: { value: 'still-typing' } });

        act(() => { window.dispatchEvent(new Event('blur')); });

        expect(screen.getByLabelText('Password')).toHaveValue('still-typing');
    });

    it('stops listening once the screen unmounts', () => {
        mount();
        cleanup();
        expect(() => document.dispatchEvent(new Event('pause'))).not.toThrow();
    });
});
