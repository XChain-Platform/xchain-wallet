// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { clearLockoutState } from '../../../packages/core/src/flows/index.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

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
        <MessagingProvider shell="popup" messaging={messaging}>
            <Locked onUnlocked={vi.fn()} />
        </MessagingProvider>,
    );
}

describe('Locked unlock button', () => {
    it('draws the Unlock Wallet submit in the success (green) fill, not primary', () => {
        clearLockoutState();
        mount();
        const button = screen.getByRole('button', { name: 'Unlock Wallet' });
        expect(button).toHaveAttribute('type', 'submit');
        expect(buttonStyles.success).toBeTruthy();
        expect(button).toHaveClass(buttonStyles.success);
        expect(button).not.toHaveClass(buttonStyles.primary);
    });
});
