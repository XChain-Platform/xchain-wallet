// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Safety rows that open a password form (biometric enrolment, duress
// passphrase) take keyboard focus into the form, close it on Escape before
// the Settings page behind it, and hand focus back to the row's button.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const biometric = vi.hoisted(() => ({ registered: false }));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: { unlockWallet: vi.fn() } }),
}));
vi.mock('../../../packages/core/src/flows/biometricUnlock.js', () => ({
    describeBiometric: vi.fn(async () => ({
        supported: true,
        mechanism: 'fingerprint',
        wrapNote: '',
        reason: '',
    })),
    isBiometricRegistered: () => biometric.registered,
    registerBiometricCredential: vi.fn(),
    clearBiometricCredential: vi.fn(),
}));

const { BiometricRow } = await import(
    '../../../packages/core/src/shared/components/settings/BiometricRow.jsx'
);
const { DuressPassphraseRow } = await import(
    '../../../packages/core/src/shared/components/settings/DuressPassphraseRow.jsx'
);

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

const pressEscape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });

function activate(button) {
    act(() => button.focus());
    fireEvent.click(button);
}

describe('Safety password forms keyboard use', () => {
    it('opens the duress passphrase form on its first field and closes it on Escape back to Set', () => {
        render(<main><DuressPassphraseRow /></main>);
        activate(screen.getByRole('button', { name: 'Set' }));
        expect(screen.getByLabelText('Current wallet password')).toHaveFocus();

        pressEscape();
        expect(screen.queryByLabelText('Current wallet password')).toBeNull();
        expect(screen.getByRole('button', { name: 'Set' })).toHaveFocus();
    });

    it('opens the biometric enrolment form on its password field and closes it on Escape', async () => {
        render(<main><BiometricRow /></main>);
        const enable = await screen.findByRole('button', { name: /^Enable/ });
        activate(enable);
        const field = document.querySelector('form input[type="password"]');
        expect(field, 'the enrolment form opens').not.toBeNull();
        expect(field).toHaveFocus();

        pressEscape();
        expect(document.querySelector('form input[type="password"]')).toBeNull();
        expect(screen.getByRole('button', { name: /^Enable/ })).toHaveFocus();
    });
});
