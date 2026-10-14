// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The change-password fields are disabled while the change runs, and a
// disabled field drops focus to the page. A refused change left the cursor
// nowhere, so a keyboard user had to tab back from the top of the page.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThisWalletSection } from '../../../packages/core/src/shared/components/settings/ThisWalletSection.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,eA==') } }));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function open(messaging) {
    render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <ToastHost>
                <ThisWalletSection
                    activeWallet={{ id: 'wallet-1', name: 'Focus Wallet', format: 'bip39' }}
                    activeAccount={{ id: 'account-0', name: 'Main', index: 0 }}
                />
            </ToastHost>
        </MessagingContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    return {
        current: screen.getByLabelText('Current wallet password'),
        next: screen.getByLabelText('New wallet password'),
        confirm: screen.getByLabelText('Confirm new wallet password'),
    };
}

describe('change password focus after a refusal', () => {
    it('returns the cursor to the current password, selected, after a wrong password', async () => {
        const wrong = Object.assign(new Error('bad'), { name: 'InvalidPasswordError' });
        const { current, next, confirm } = open({ changePassword: vi.fn(async () => { throw wrong; }) });
        fireEvent.change(current, { target: { value: 'wrong-password' } });
        fireEvent.change(next, { target: { value: 'replacement-1' } });
        fireEvent.change(confirm, { target: { value: 'replacement-1' } });
        confirm.focus();
        fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

        await waitFor(() => expect(current).toHaveFocus());
        expect(current).toBeEnabled();
        expect(current.selectionStart).toBe(0);
        expect(current.selectionEnd).toBe('wrong-password'.length);
    });

    it('moves the cursor to the field a validation message is about', () => {
        const { current, next, confirm } = open({ changePassword: vi.fn() });
        fireEvent.change(current, { target: { value: 'old-password' } });
        fireEvent.change(next, { target: { value: 'short' } });
        fireEvent.change(confirm, { target: { value: 'short' } });
        confirm.focus();
        fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
        expect(next).toHaveFocus();
    });
});
