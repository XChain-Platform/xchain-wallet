// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Test backup form takes a whole recovery phrase in clear text, so it
// sits under the same screen guard as import and reveal: on Android the
// window carries FLAG_SECURE while the form is open and drops it once the
// form closes.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    __resetScreenGuardForTests,
    installScreenGuard,
} from '../../../packages/core/src/shared/utils/screenGuard.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    __resetScreenGuardForTests();
});

function mount(activeWallet = { id: 'w1', name: 'Cold' }) {
    const messaging = { dryRunRestoreRequest: vi.fn(async () => ({ overallMatch: true, chains: [] })) };
    return render(
        <MessagingProvider shell="popup" messaging={messaging}>
            <BackupSection activeWallet={activeWallet} />
        </MessagingProvider>,
    );
}

describe('BackupSection Test backup: screen guard', () => {
    it('protects the screen while the recovery phrase form is open', () => {
        const guard = vi.fn();
        installScreenGuard(guard);
        mount();
        expect(guard).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Test…' }));
        expect(screen.getByLabelText('Recovery phrase to test')).toBeInTheDocument();
        expect(guard).toHaveBeenLastCalledWith(true);

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByLabelText('Recovery phrase to test')).not.toBeInTheDocument();
        expect(guard).toHaveBeenLastCalledWith(false);
    });

    it('starts the form with the stored legacy format selected', () => {
        mount({ id: 'w1', name: 'Legacy', format: 'counterwallet-legacy' });

        fireEvent.click(screen.getByRole('button', { name: 'Test…' }));

        expect(screen.queryByLabelText('Phrase format')).not.toBeInTheDocument();
        expect(screen.getByText('Counterwallet legacy')).toBeInTheDocument();
        expect(screen.queryByLabelText('Extra passphrase')).not.toBeInTheDocument();
    });

    it('shows the stored standard format and its passphrase field', () => {
        mount({ id: 'w1', name: 'Standard', format: 'bip39' });

        fireEvent.click(screen.getByRole('button', { name: 'Test…' }));

        expect(screen.queryByLabelText('Phrase format')).not.toBeInTheDocument();
        expect(screen.getByText('Standard (12 to 24 words)')).toBeInTheDocument();
        expect(screen.getByLabelText('Extra passphrase')).toBeInTheDocument();
    });

    it('submits without an editable format override', () => {
        const messaging = {
            dryRunRestoreRequest: vi.fn(() => new Promise(() => {})),
        };
        render(
            <MessagingProvider shell="popup" messaging={messaging}>
                <BackupSection activeWallet={{
                    id: 'w1', name: 'Legacy', format: 'counterwallet-legacy',
                }} />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Test…' }));
        fireEvent.change(screen.getByLabelText('Recovery phrase to test'), {
            target: { value: 'explode gaze wolf admit nice charm except three any guitar into color' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Run test' }));

        expect(messaging.dryRunRestoreRequest).toHaveBeenCalledWith(expect.objectContaining({
            bip39Passphrase: '',
        }));
        expect(messaging.dryRunRestoreRequest.mock.calls[0][0]).not.toHaveProperty('format');
    });
});
