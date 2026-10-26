// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: backgrounding the native app keeps the onboarding step.
//
//   [P1] 2026-10-23: on the Android app, a pause dismisses every overlay, and
//        Create and Import wallet registered their step Back as an overlay.
//        Backgrounding on the phrase step returned to the password form (the
//        next Continue generated a different phrase), and backgrounding on
//        the password form or the import form left for Welcome and cleared
//        what was typed.

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../packages/core/src/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '../../packages/core/src/shared/routes/ImportWallet.jsx';
import {
    dismissAllOverlays,
    registerBackHandler,
    resetBackStackForTests,
} from '../../packages/core/src/ui/backStack.js';

const PASSWORD = 'correct-horse-battery';
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const { generateBip39Mnemonic } = vi.hoisted(() => ({
    generateBip39Mnemonic: vi.fn(() => 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, crypto: { ...actual.crypto, generateBip39Mnemonic } };
});

vi.mock('../../packages/core/src/shared/utils/nextPaint.js', () => ({
    nextPaint: () => Promise.resolve(),
}));

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    generateBip39Mnemonic.mockClear();
});

function renderWith(node) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic: vi.fn().mockResolvedValue({}) }}>
            {node}
        </MessagingProvider>,
    );
}

/** What App.jsx runs when the native app pauses. */
function backgroundTheApp() {
    act(() => dismissAllOverlays());
}

function fillPasswords() {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
}

describe('backgrounding the native app during onboarding', () => {
    it('[REGRESSION P1] keeps the recovery phrase step and its phrase', async () => {
        const onBack = vi.fn();
        renderWith(<CreateWallet onBack={onBack} onCreated={vi.fn()} />);
        fillPasswords();
        fireEvent.submit(screen.getByLabelText('Confirm password').form);
        await screen.findByRole('heading', { name: 'Write down your recovery phrase' });
        expect(generateBip39Mnemonic).toHaveBeenCalledOnce();

        backgroundTheApp();

        expect(screen.getByRole('heading', { name: 'Write down your recovery phrase' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(generateBip39Mnemonic).toHaveBeenCalledOnce();
        expect(onBack).not.toHaveBeenCalled();
    });

    it('[REGRESSION P1] keeps the typed password on the create form', () => {
        const onBack = vi.fn();
        renderWith(<CreateWallet onBack={onBack} onCreated={vi.fn()} />);
        fillPasswords();

        backgroundTheApp();

        expect(screen.getByLabelText('Password')).toHaveValue(PASSWORD);
        expect(screen.getByLabelText('Confirm password')).toHaveValue(PASSWORD);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('[REGRESSION P1] keeps the import form and what was typed', () => {
        const onBack = vi.fn();
        renderWith(<ImportWallet onBack={onBack} onImported={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });

        backgroundTheApp();

        expect(screen.getByLabelText('Recovery phrase')).toHaveValue(PHRASE);
        expect(screen.getByLabelText('Password')).toHaveValue(PASSWORD);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('[REGRESSION P1] closes only the import camera, leaving the form', () => {
        const onBack = vi.fn();
        renderWith(<ImportWallet onBack={onBack} onImported={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Scan QR' }));
        expect(screen.getByRole('button', { name: 'Cancel scan' })).toBeInTheDocument();

        backgroundTheApp();

        expect(screen.getByRole('button', { name: 'Scan QR' })).toBeInTheDocument();
        expect(screen.getByLabelText('Recovery phrase')).toHaveValue(PHRASE);
        expect(screen.getByLabelText('Password')).toHaveValue(PASSWORD);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('[REGRESSION P1] still closes a real overlay above the flow', () => {
        const onBack = vi.fn();
        renderWith(<CreateWallet onBack={onBack} onCreated={vi.fn()} />);
        const closeSheet = vi.fn();
        const unregister = registerBackHandler(closeSheet);

        backgroundTheApp();

        expect(closeSheet).toHaveBeenCalledOnce();
        expect(onBack).not.toHaveBeenCalled();
        unregister();
    });
});
