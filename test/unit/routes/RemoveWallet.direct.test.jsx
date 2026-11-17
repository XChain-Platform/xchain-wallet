// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Remove Wallet lands directly on its final confirm step: warning card, the
// typed wallet name, one full-width red button. No intro card, no second step.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { RemoveWallet } from '../../../packages/core/src/shared/routes/RemoveWallet.jsx';
import { ThisWalletSection } from '../../../packages/core/src/shared/components/settings/ThisWalletSection.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';

afterEach(() => cleanup());

function mountPage(messaging, props = {}) {
    return render(
        <MessagingProvider messaging={messaging} shell="web">
            <RemoveWallet walletId="w1" walletName="Savings" activeWalletId={null} onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

describe('<RemoveWallet> direct page', () => {
    it('shows the final step at once, with no intermediate button', () => {
        mountPage({ removeWallet: vi.fn() });
        expect(screen.getByLabelText('Confirm wallet name')).toBeTruthy();
        expect(screen.getByText(/can't be recovered without its backup or recovery phrase/i)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Remove…?$/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Remove Wallet' })).toHaveLength(1);
    });

    it('refuses removal until the exact name is typed, then removes', async () => {
        const removeWallet = vi.fn().mockResolvedValue({});
        const onRemoved = vi.fn();
        mountPage({ removeWallet }, { onRemoved });
        const button = screen.getByRole('button', { name: 'Remove Wallet' });
        // G130: the red button is enabled; a tap before the name matches is
        // refused with the reason at the top and on the field.
        expect(button.disabled).toBe(false);
        const input = screen.getByLabelText('Confirm wallet name');
        fireEvent.change(input, { target: { value: 'savings' } });
        await act(async () => { fireEvent.click(button); });
        expect(removeWallet).not.toHaveBeenCalled();
        expect(screen.getByRole('alert', { name: /form errors/i })).toHaveTextContent(/Type the wallet name/);
        fireEvent.change(input, { target: { value: 'Savings' } });
        await act(async () => { fireEvent.click(button); });
        expect(removeWallet).toHaveBeenCalledWith({ walletId: 'w1' });
        expect(onRemoved).toHaveBeenCalledWith('w1');
    });

    it('does not remove when the name does not match, even on submit', async () => {
        const removeWallet = vi.fn();
        mountPage({ removeWallet });
        fireEvent.change(screen.getByLabelText('Confirm wallet name'), { target: { value: 'Sav' } });
        await act(async () => { fireEvent.submit(screen.getByLabelText('Confirm wallet name').closest('form')); });
        expect(removeWallet).not.toHaveBeenCalled();
    });
});

describe('Settings keeps its own two-step Remove wallet', () => {
    it('shows the row button first and the confirm after it', () => {
        render(
            <MessagingContext.Provider value={{ messaging: {}, shell: 'web' }}>
                <ToastHost>
                    <ThisWalletSection activeWallet={{ id: 'w1', name: 'Savings', format: 'bip39' }} only="remove" />
                </ToastHost>
            </MessagingContext.Provider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
        expect(screen.getByLabelText('Confirm wallet name')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });
});
