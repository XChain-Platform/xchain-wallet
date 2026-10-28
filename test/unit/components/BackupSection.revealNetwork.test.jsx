// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The recovery-phrase reveal works with the device offline and keeps working
// through offline and online transitions, both while the phrase is shown and
// while the password check is in flight. The revealed words carry
// data-secret so every screenshot harness masks them. Assertions compare by
// equality and count only, so no phrase word reaches a failure message.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { __resetScreenGuardForTests } from '../../../packages/core/src/shared/utils/screenGuard.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { MnemonicGrid } from '../../../packages/core/src/shared/components/MnemonicGrid.jsx';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const activeWallet = { id: 'w1', name: 'Cold' };

let onLineDescriptor;

beforeEach(() => {
    onLineDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
});

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    __resetScreenGuardForTests();
    if (onLineDescriptor) Object.defineProperty(window.navigator, 'onLine', onLineDescriptor);
    else delete window.navigator.onLine;
});

function mount(revealMnemonicRequest) {
    return render(
        <MessagingProvider shell="popup" messaging={{ revealMnemonicRequest }}>
            <BackupSection activeWallet={activeWallet} />
        </MessagingProvider>,
    );
}

function phraseInDom() {
    return (document.body.textContent || '').includes('abandon abandon');
}

function flipNetwork() {
    act(() => {
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('offline'));
    });
}

describe('BackupSection reveal: offline and network transitions', () => {
    it('reveals offline, survives offline/online events while shown, and marks the words data-secret', async () => {
        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: MNEMONIC, format: 'bip39', passphraseEnabled: false, bip39Passphrase: null,
        }));
        mount(revealMnemonicRequest);
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        await waitFor(() => expect(screen.getByText('Your recovery phrase')).toBeTruthy());

        expect(revealMnemonicRequest).toHaveBeenCalledOnce();
        expect(screen.queryByLabelText('Wallet password')).toBeNull();

        const words = screen.getByLabelText('Reveal recovery phrase');
        expect(words.hasAttribute('data-secret')).toBe(true);
        expect(words.textContent === MNEMONIC).toBe(true);

        flipNetwork();

        expect(screen.getByText('Your recovery phrase')).toBeTruthy();
        expect(screen.getByLabelText('Reveal recovery phrase').textContent === MNEMONIC).toBe(true);
        expect(document.querySelectorAll('[data-xc-recovery-sheet]').length).toBe(1);

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(phraseInDom()).toBe(false);
    });

    it('marks the stored passphrase data-secret too', async () => {
        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: MNEMONIC, format: 'bip39', passphraseEnabled: true, bip39Passphrase: 'my 25th word',
        }));
        mount(revealMnemonicRequest);
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        await waitFor(() => expect(screen.getByText('Your recovery phrase')).toBeTruthy());

        expect(screen.getByLabelText('Reveal passphrase').hasAttribute('data-secret')).toBe(true);
    });

    it('completes cleanly when the network flips mid-password-submit', async () => {
        let settle;
        const pending = new Promise((resolve) => { settle = resolve; });
        const revealMnemonicRequest = vi.fn(() => pending);
        mount(revealMnemonicRequest);
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));

        flipNetwork();
        expect(screen.getByRole('button', { name: 'Revealing…' })).toBeDisabled();

        await act(async () => {
            settle({ mnemonic: MNEMONIC, format: 'bip39', passphraseEnabled: false, bip39Passphrase: null });
            await pending;
        });

        expect(screen.getByText('Your recovery phrase')).toBeTruthy();
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        expect(screen.getByLabelText('Reveal recovery phrase').hasAttribute('data-secret')).toBe(true);
        expect(revealMnemonicRequest).toHaveBeenCalledOnce();
    });

    it('refuses cleanly when the request rejects mid-submit with the network flipping, and retries', async () => {
        let fail;
        const pending = new Promise((_, reject) => { fail = reject; });
        const revealMnemonicRequest = vi.fn()
            .mockImplementationOnce(() => pending)
            .mockImplementationOnce(async () => ({
                mnemonic: MNEMONIC, format: 'bip39', passphraseEnabled: false, bip39Passphrase: null,
            }));
        mount(revealMnemonicRequest);
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'typo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));

        flipNetwork();
        await act(async () => {
            fail(Object.assign(new Error('aes/gcm: invalid ghash tag'), { name: 'AeadAuthError' }));
            await pending.catch(() => {});
        });

        expect(await screen.findByText('Incorrect password.')).toBeTruthy();
        expect(phraseInDom()).toBe(false);
        expect(screen.queryByText('Your recovery phrase')).toBeNull();

        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        await waitFor(() => expect(screen.getByText('Your recovery phrase')).toBeTruthy());
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        expect(revealMnemonicRequest).toHaveBeenCalledTimes(2);
    });

    it('marks the MnemonicGrid word list data-secret once revealed offline', () => {
        render(<MnemonicGrid mnemonic={MNEMONIC} />);
        fireEvent.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
        flipNetwork();
        const list = screen.getByRole('list');
        expect(list.hasAttribute('data-secret')).toBe(true);
        expect(list.querySelectorAll('li').length).toBe(12);
    });
});
