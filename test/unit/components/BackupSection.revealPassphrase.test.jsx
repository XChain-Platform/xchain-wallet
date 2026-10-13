// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.6: the recovery-phrase row also reveals a stored 25th-word passphrase,
// under the same tap-to-reveal blur and the same password gate as the
// recovery phrase itself. No copy control appears in that block because
// clipboard contents are available to other apps, and a wallet without
// a stored passphrase renders nothing extra.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    __resetScreenGuardForTests,
    installScreenGuard,
} from '../../../packages/core/src/shared/utils/screenGuard.js';

afterEach(() => {
    cleanup();
    __resetScreenGuardForTests();
});

const activeWallet = { id: 'w1', name: 'Cold' };

function mount(revealMnemonicRequest) {
    const messaging = { revealMnemonicRequest };
    return render(
        <MessagingProvider shell="popup" messaging={messaging}>
            <BackupSection activeWallet={activeWallet} />
        </MessagingProvider>,
    );
}

/** Walks the reveal flow up to and including the password submit. */
async function revealSeed() {
    fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
    fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    await waitFor(() => expect(screen.getByText('Your recovery phrase')).toBeTruthy());
}

describe('BackupSection reveal: stored 25th-word passphrase', () => {
    it('blocks selection and copy while protecting the screen until the phrase leaves the DOM', async () => {
        const guard = vi.fn();
        installScreenGuard(guard);
        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            format: 'bip39',
            passphraseEnabled: true,
            bip39Passphrase: 'my 25th word',
        }));
        mount(revealMnemonicRequest);

        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        expect(guard).toHaveBeenLastCalledWith(true);
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        await waitFor(() => expect(screen.getByText('Your recovery phrase')).toBeTruthy());

        const sheet = document.querySelector('[data-xc-recovery-sheet]');
        const words = screen.getByText(/abandon abandon/).closest('button');
        expect(fireEvent.copy(words)).toBe(false);
        expect(words.style.userSelect).toBe('none');

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(sheet).not.toBeInTheDocument();
        expect(document.body.textContent).not.toContain('abandon abandon');
        expect(document.body.textContent).not.toContain('my 25th word');
        expect(guard).toHaveBeenLastCalledWith(false);
    });

    it('removes the old phrase immediately when the active wallet changes', async () => {
        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            format: 'bip39',
            passphraseEnabled: false,
            bip39Passphrase: null,
        }));
        const view = mount(revealMnemonicRequest);
        await revealSeed();

        view.rerender(
            <MessagingProvider shell="popup" messaging={{ revealMnemonicRequest }}>
                <BackupSection activeWallet={{ id: 'w2', name: 'Hot' }} />
            </MessagingProvider>,
        );

        expect(document.body.textContent).not.toContain('abandon abandon');
        expect(screen.getByRole('button', { name: 'Show…' })).toBeTruthy();
    });

    it('discards an in-flight reveal when the active wallet changes', async () => {
        let settleReveal;
        const revealResponse = new Promise((resolve) => { settleReveal = resolve; });
        const revealMnemonicRequest = vi.fn(() => revealResponse);
        const view = mount(revealMnemonicRequest);

        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        view.rerender(
            <MessagingProvider shell="popup" messaging={{ revealMnemonicRequest }}>
                <BackupSection activeWallet={{ id: 'w2', name: 'Hot' }} />
            </MessagingProvider>,
        );

        await act(async () => {
            settleReveal({
                mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
                format: 'bip39',
                passphraseEnabled: false,
                bip39Passphrase: null,
            });
            await revealResponse;
        });

        expect(document.body.textContent).not.toContain('abandon abandon');
        expect(screen.getByRole('button', { name: 'Show…' })).toBeTruthy();
    });

    it('shows the passphrase under the words, with no copy control anywhere in the reveal block', async () => {
        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            format: 'bip39',
            passphraseEnabled: true,
            bip39Passphrase: 'my 25th word',
        }));
        mount(revealMnemonicRequest);
        await revealSeed();

        expect(screen.getByText(/Never share your recovery phrase/)).toHaveTextContent(
            'Never share your recovery phrase. Anyone with it can spend your funds.',
        );
        expect(screen.getByText('Passphrase (25th word)')).toBeTruthy();
        expect(screen.getByText('my 25th word')).toBeTruthy();

        // No clipboard write anywhere on this panel while the reveal is shown.
        const buttons = screen.getAllByRole('button').map((b) => b.textContent || '');
        expect(buttons.some((t) => /copy/i.test(t))).toBe(false);
    });

    it('renders both the words and the passphrase behind the same blur, toggled by the same control', async () => {
        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            format: 'bip39',
            passphraseEnabled: true,
            bip39Passphrase: 'my 25th word',
        }));
        mount(revealMnemonicRequest);
        await revealSeed();

        const wordsBtn = screen.getByText(/abandon abandon/).closest('button');
        const passBtn = screen.getByText('my 25th word').closest('button');
        expect(wordsBtn.style.filter).toBe('blur(8px)');
        expect(passBtn.style.filter).toBe('blur(8px)');

        // One toggle (the recovery-phrase button's own reveal control) uncovers both.
        fireEvent.click(screen.getByLabelText('Reveal recovery phrase'));
        expect(wordsBtn.style.filter).toBe('none');
        expect(passBtn.style.filter).toBe('none');
    });

    it('prints the isolated recovery sheet only after the phrase is revealed', async () => {
        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            format: 'bip39',
            passphraseEnabled: false,
            bip39Passphrase: null,
        }));
        const print = vi.spyOn(window, 'print').mockImplementation(() => {
            expect(document.body).toHaveClass('xc-print-recovery-sheet');
        });
        mount(revealMnemonicRequest);
        await revealSeed();

        expect(screen.queryByRole('button', { name: 'Print recovery sheet' })).toBeNull();
        fireEvent.click(screen.getByLabelText('Reveal recovery phrase'));
        fireEvent.click(screen.getByRole('button', { name: 'Print recovery sheet' }));

        expect(print).toHaveBeenCalledOnce();
        expect(document.body).not.toHaveClass('xc-print-recovery-sheet');
        expect(screen.getByText('Wallet: Cold')).toBeTruthy();
    });

    it('renders nothing extra for a wallet with passphraseEnabled false', async () => {
        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            format: 'bip39',
            passphraseEnabled: false,
            bip39Passphrase: null,
        }));
        mount(revealMnemonicRequest);
        await revealSeed();

        expect(screen.queryByText('Passphrase (25th word)')).toBeNull();
        expect(screen.queryByText(/25th-word passphrase/)).toBeNull();
    });

    it('shows a not-yet-stored note for a legacy wallet with passphraseEnabled true but nothing captured', async () => {
        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            format: 'bip39',
            passphraseEnabled: true,
            bip39Passphrase: null,
        }));
        mount(revealMnemonicRequest);
        await revealSeed();

        expect(screen.queryByText('Passphrase (25th word)')).toBeNull();
        expect(screen.getByText(/has not been stored on this device yet/)).toBeTruthy();
    });
});

describe('BackupSection reveal: a failed password check', () => {
    /** Submits the password form; the reveal is expected to fail. */
    async function submitWrongPassword() {
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'typo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    }

    it.each(['AeadAuthError', 'InvalidPasswordError'])('says the password is wrong for %s, not the cipher text', async (name) => {
        const revealMnemonicRequest = vi.fn(async () => {
            throw Object.assign(new Error('aes/gcm: invalid ghash tag'), { name });
        });
        mount(revealMnemonicRequest);
        await submitWrongPassword();

        expect(await screen.findByText('Incorrect password.')).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/aes\/gcm|ghash/);
    });

    it('swaps a function-prefixed flow error for plain copy', async () => {
        const revealMnemonicRequest = vi.fn(async () => {
            throw new Error('revealMnemonic: password is required');
        });
        mount(revealMnemonicRequest);
        await submitWrongPassword();

        expect(await screen.findByText('Could not show the recovery phrase. Try again.')).toBeTruthy();
        expect(document.body.textContent).not.toContain('revealMnemonic:');
    });
});
