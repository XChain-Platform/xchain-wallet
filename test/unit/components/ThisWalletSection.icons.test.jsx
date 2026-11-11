// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThisWalletSection } from '../../../packages/core/src/shared/components/settings/ThisWalletSection.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const WALLET = { id: 'wallet-active', name: 'Active Wallet', format: 'bip39' };

function mount() {
    return render(
        <MessagingContext.Provider value={{ messaging: {}, shell: 'web' }}>
            <ToastHost>
                <ThisWalletSection
                    activeWallet={WALLET}
                    activeAccount={{ id: 'a', name: 'Main', index: 0 }}
                    onOpenWalletPicker={() => {}}
                />
            </ToastHost>
        </MessagingContext.Provider>,
    );
}

const hasIcon = (button) => Boolean(button.querySelector('svg'));

afterEach(() => cleanup());

describe('ThisWalletSection button icons and main actions', () => {
    it('gives every row button an icon', () => {
        mount();
        for (const name of ['Switch / rename…', 'Export…', 'Change…', 'Remove…']) {
            expect(hasIcon(screen.getByRole('button', { name }))).toBe(true);
        }
    });

    it('makes Export keys the green main action with icons on Cancel and the submit', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        const submit = screen.getByRole('button', { name: 'Export keys' });
        expect(submit).toHaveClass(buttonStyles.success);
        expect(hasIcon(submit)).toBe(true);
        expect(hasIcon(screen.getByRole('button', { name: 'Cancel' }))).toBe(true);
        expect(screen.getByRole('button', { name: /About Confirm wallet password/i })).toBeTruthy();
    });

    it('makes Change password the green main action with a help tip on each password field', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
        const submit = screen.getByRole('button', { name: 'Change password' });
        expect(submit).toHaveClass(buttonStyles.success);
        expect(hasIcon(submit)).toBe(true);
        expect(hasIcon(screen.getByRole('button', { name: 'Cancel' }))).toBe(true);
        for (const field of ['Current wallet password', 'New wallet password', 'Confirm new wallet password']) {
            expect(screen.getByRole('button', { name: new RegExp(`About ${field}`, 'i') })).toBeTruthy();
        }
    });

    it('keeps the remove confirm as danger and gives it a trash icon', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
        const confirm = screen.getByRole('button', { name: 'Remove wallet' });
        expect(confirm).toHaveClass(buttonStyles.danger);
        expect(hasIcon(confirm)).toBe(true);
        expect(hasIcon(screen.getByRole('button', { name: 'Cancel' }))).toBe(true);
    });
});
