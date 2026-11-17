// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Show Recovery Phrase opens on the password gate itself, and the phrase is
// absent from the page and the logs until the gate passes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ViewRecoveryPhrase } from '../../../packages/core/src/shared/routes/ViewRecoveryPhrase.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const FIXTURE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('<ViewRecoveryPhrase> direct page', () => {
    it('lands on one page with the password and the concealed grid, phrase hidden', () => {
        render(
            <MessagingProvider messaging={{ revealMnemonicRequest: vi.fn() }} shell="web">
                <ViewRecoveryPhrase walletId="w1" walletName="Savings" onBack={() => {}} />
            </MessagingProvider>,
        );
        expect(screen.getByLabelText('Wallet password')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: /reveal/i })).toHaveLength(1);
        expect(document.querySelector('[data-mnemonic-card]')).not.toBeNull();
        expect(document.body.textContent).not.toContain('abandon');
    });

    it('reveals only after the gate and never logs the phrase', async () => {
        const logs = ['log', 'info', 'warn', 'error', 'debug'].map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
        const revealMnemonicRequest = vi.fn().mockResolvedValue({ mnemonic: FIXTURE });
        render(
            <MessagingProvider messaging={{ revealMnemonicRequest }} shell="web">
                <ViewRecoveryPhrase walletId="w1" walletName="Savings" onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'test-fixture-pw' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /reveal/i })); });
        expect(revealMnemonicRequest).toHaveBeenCalledWith({ walletId: 'w1', password: 'test-fixture-pw' });
        expect(document.body.textContent).toContain('abandon');
        expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull();
        for (const spy of logs) {
            expect(JSON.stringify(spy.mock.calls)).not.toContain('abandon');
            expect(JSON.stringify(spy.mock.calls)).not.toContain('test-fixture-pw');
        }
    });
});
