// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WIF = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn';
const PASSWORD = 'correct-horse-battery';

function renderImport({ messaging = {}, onBack = () => {}, onImported = () => {} } = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ImportWallet
                onBack={onBack}
                onImported={onImported}
                mode="fresh"
            />
        </MessagingProvider>,
    );
}

function fillPhraseImport() {
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
}

afterEach(() => {
    cleanup();
    delete navigator.clipboard;
});

describe('ImportWallet secret lifecycle', () => {
    it('clears hidden inputs whenever the import type changes', () => {
        renderImport();
        fillPhraseImport();
        fireEvent.click(screen.getByLabelText(/This wallet uses a BIP39 passphrase/));
        fireEvent.change(screen.getByLabelText('BIP39 passphrase'), {
            target: { value: 'phrase-password' },
        });

        fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
        expect(screen.getByLabelText('WIF private key')).toHaveValue('');
        expect(screen.getByLabelText('Password')).toHaveValue('');
        expect(screen.getByLabelText('Confirm password')).toHaveValue('');

        fireEvent.change(screen.getByLabelText('WIF private key'), { target: { value: WIF } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByLabelText(/isn't recoverable from a recovery phrase/));
        fireEvent.click(screen.getByRole('tab', { name: 'Recovery phrase' }));

        expect(screen.getByLabelText('Recovery phrase')).toHaveValue('');
        expect(screen.getByLabelText('Password')).toHaveValue('');
        expect(screen.getByLabelText('Confirm password')).toHaveValue('');
        expect(screen.getByLabelText(/This wallet uses a BIP39 passphrase/)).not.toBeChecked();

        fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
        expect(screen.getByLabelText('WIF private key')).toHaveValue('');
        expect(screen.getByLabelText(/isn't recoverable from a recovery phrase/)).not.toBeChecked();
    });

    it('discards a clipboard result from an earlier visit to the phrase lane', async () => {
        let resolveClipboard;
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn(() => new Promise((resolve) => {
                    resolveClipboard = resolve;
                })),
            },
        });
        renderImport();

        fireEvent.click(screen.getByRole('button', { name: 'Paste recovery phrase from clipboard' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Recovery phrase' }));
        await act(async () => {
            resolveClipboard(PHRASE);
            await Promise.resolve();
        });

        expect(screen.getByLabelText('Recovery phrase')).toHaveValue('');
    });

    it('locks same-tick submissions before the busy render commits', async () => {
        let finishImport;
        const importMnemonic = vi.fn(() => new Promise((resolve) => {
            finishImport = resolve;
        }));
        renderImport({ messaging: { importMnemonic } });
        fillPhraseImport();
        const form = screen.getByRole('button', { name: 'Import' }).closest('form');

        act(() => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });

        expect(importMnemonic).toHaveBeenCalledTimes(1);
        await act(async () => finishImport({ walletId: 'wallet-1' }));
        expect(await screen.findByText('Automatic Donation System')).toBeTruthy();
    });

    it('catches a rejected continuation and makes Continue retryable', async () => {
        const onImported = vi.fn()
            .mockRejectedValueOnce(new Error('navigation failed'))
            .mockResolvedValueOnce(undefined);
        renderImport({
            messaging: { importMnemonic: vi.fn().mockResolvedValue({ walletId: 'wallet-1' }) },
            onImported,
        });
        fillPhraseImport();
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        const continueButton = await screen.findByRole('button', { name: 'Continue' });

        fireEvent.click(continueButton);
        expect(await screen.findByRole('alert')).toHaveTextContent('navigation failed');
        await waitFor(() => expect(continueButton).toBeEnabled());

        fireEvent.click(continueButton);
        await waitFor(() => expect(onImported).toHaveBeenCalledTimes(2));
    });

    it('scrubs every backup secret before invoking Back', () => {
        const onBack = vi.fn();
        renderImport({ onBack });
        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));
        fireEvent.change(screen.getByLabelText('Backup file contents'), {
            target: { value: '{"encrypted":"content"}' },
        });
        fireEvent.change(screen.getByLabelText('Backup password'), {
            target: { value: 'file-password' },
        });
        fireEvent.change(screen.getByLabelText('Password of the wallet in this backup'), {
            target: { value: 'wallet-password' },
        });
        fireEvent.change(screen.getByLabelText('Password for this device'), {
            target: { value: 'device-password' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Back to wallet setup' }));

        expect(onBack).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText('Backup file contents')).toHaveValue('');
        expect(screen.getByLabelText('Backup password')).toHaveValue('');
        expect(screen.getByLabelText('Password of the wallet in this backup')).toHaveValue('');
        expect(screen.getByLabelText('Password for this device')).toHaveValue('');
    });
});
