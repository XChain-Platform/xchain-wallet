// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.6: the reveal-seed row also reveals a stored 25th-word passphrase,
// under the same tap-to-reveal blur and the same password gate as the
// seed phrase itself. No copy control anywhere in that block (the row's
// own hint says "Never type or paste it into anything else", so a
// clipboard button would contradict the sentence directly above it),
// and a wallet without a stored passphrase renders nothing extra.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

afterEach(() => cleanup());

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
    await waitFor(() => expect(screen.getByText('Your seed phrase')).toBeTruthy());
}

describe('BackupSection reveal: stored 25th-word passphrase', () => {
    it('shows the passphrase under the words, with no copy control anywhere in the reveal block', async () => {
        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            format: 'bip39',
            passphraseEnabled: true,
            bip39Passphrase: 'my 25th word',
        }));
        mount(revealMnemonicRequest);
        await revealSeed();

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

        // One toggle (the seed button's own reveal control) uncovers both.
        fireEvent.click(screen.getByLabelText('Reveal seed phrase'));
        expect(wordsBtn.style.filter).toBe('none');
        expect(passBtn.style.filter).toBe('none');
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
