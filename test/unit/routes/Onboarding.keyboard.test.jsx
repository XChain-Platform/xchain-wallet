// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

const { generateBip39Mnemonic } = vi.hoisted(() => ({
    generateBip39Mnemonic: vi.fn(() => PHRASE),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, crypto: { ...actual.crypto, generateBip39Mnemonic } };
});

vi.mock('../../../packages/core/src/shared/utils/pickQuizPositions.js', () => ({
    pickQuizPositions: () => [1, 2, 3],
}));

vi.mock('../../../packages/core/src/shared/utils/nextPaint.js', () => ({
    nextPaint: () => Promise.resolve(),
}));

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    generateBip39Mnemonic.mockClear();
});

function renderCreate({ onBack = vi.fn(), importMnemonic = vi.fn().mockResolvedValue({}) } = {}) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <CreateWallet onBack={onBack} onCreated={() => {}} />
        </MessagingProvider>,
    );
    return { onBack, importMnemonic };
}

function renderImport({ onBack = vi.fn(), importMnemonic = vi.fn().mockResolvedValue({}) } = {}) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <ImportWallet onBack={onBack} onImported={() => {}} />
        </MessagingProvider>,
    );
    return { onBack, importMnemonic };
}

function tabStops() {
    return Array.from(document.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => {
        if (element.hidden || element.closest('[hidden]')) return false;
        if (element instanceof HTMLInputElement && element.type === 'radio' && !element.checked) return false;
        return true;
    });
}

function pressTab() {
    const current = document.activeElement;
    fireEvent.keyDown(current || document.body, { key: 'Tab' });
    const following = tabStops().find((element) => (
        current?.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
    ));
    (following || tabStops()[0])?.focus();
}

function pressEnter(input) {
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.submit(input.form);
}

function fillCreatePasswords(password = PASSWORD, confirm = password) {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
}

describe('create onboarding keyboard flow', () => {
    it('follows the visual tab order and advances on Enter only with valid input', async () => {
        let finishImport;
        const importMnemonic = vi.fn(() => new Promise((resolve) => { finishImport = resolve; }));
        renderCreate({ importMnemonic });

        const passwordHeading = screen.getByRole('heading', { name: 'Create a new wallet' });
        await waitFor(() => expect(passwordHeading).toHaveFocus());

        const expectedTabOrder = [
            screen.getByLabelText('Wallet name'),
            screen.getByLabelText('Password'),
            screen.getByLabelText('Confirm password'),
            screen.getByRole('radio', { name: /^12 words/ }),
            screen.getByRole('checkbox', { name: /Use a BIP39 passphrase/ }),
            screen.getByRole('button', { name: 'BIP39 passphrase help' }),
        ];
        for (const control of expectedTabOrder) {
            pressTab();
            expect(control).toHaveFocus();
        }

        pressEnter(screen.getByLabelText('Confirm password'));
        expect(passwordHeading).toBeInTheDocument();
        expect(generateBip39Mnemonic).not.toHaveBeenCalled();

        fillCreatePasswords('short', 'short');
        pressEnter(screen.getByLabelText('Confirm password'));
        expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters');
        expect(generateBip39Mnemonic).not.toHaveBeenCalled();

        fillCreatePasswords(PASSWORD, `${PASSWORD}-different`);
        pressEnter(screen.getByLabelText('Confirm password'));
        expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
        expect(generateBip39Mnemonic).not.toHaveBeenCalled();

        fillCreatePasswords();
        pressTab();
        expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
        pressEnter(screen.getByLabelText('Confirm password'));
        const phraseHeading = await screen.findByRole('heading', { name: 'Write down your recovery phrase' });
        expect(phraseHeading).toHaveFocus();
        expect(generateBip39Mnemonic).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('checkbox', { name: /written down my recovery phrase/i }));
        const verifyButton = screen.getByRole('button', { name: 'Verify recovery phrase' });
        verifyButton.focus();
        fireEvent.keyDown(verifyButton, { key: 'Enter' });
        fireEvent.click(verifyButton);
        const verifyHeading = await screen.findByRole('heading', { name: 'Verify your recovery phrase' });
        expect(verifyHeading).toHaveFocus();

        pressEnter(screen.getAllByLabelText(/^Word \d+$/)[0]);
        expect(screen.getByRole('alert')).toHaveTextContent('Fill in every word');
        expect(importMnemonic).not.toHaveBeenCalled();

        for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
            fireEvent.change(input, { target: { value: 'abandon' } });
        }
        pressEnter(screen.getAllByLabelText(/^Word \d+$/)[2]);
        const progressHeading = await screen.findByRole('heading', { name: 'Creating your wallet' });
        expect(progressHeading).toHaveFocus();
        expect(importMnemonic).toHaveBeenCalledOnce();

        finishImport({ walletId: 'created-wallet' });
        const noticeHeading = await screen.findByRole('heading', { name: 'Automatic Donation System' });
        expect(noticeHeading).toHaveFocus();
    });

    it('uses Escape and the header Back button for step navigation while clearing secrets', async () => {
        const onBack = vi.fn();
        renderCreate({ onBack });

        fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: 'Travel wallet' } });
        fireEvent.click(screen.getByRole('radio', { name: /^24 words/ }));
        fireEvent.click(screen.getByRole('checkbox', { name: /Use a BIP39 passphrase/ }));
        fillCreatePasswords();
        fireEvent.change(screen.getByLabelText('BIP39 passphrase'), { target: { value: 'hidden phrase' } });
        fireEvent.change(screen.getByLabelText('Confirm passphrase'), { target: { value: 'hidden phrase' } });
        pressEnter(screen.getByLabelText('Confirm password'));

        fireEvent.click(await screen.findByRole('checkbox', { name: /written down my recovery phrase/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
        fireEvent.change(await screen.findByLabelText('Word 1'), { target: { value: 'typed secret' } });

        fireEvent.keyDown(window, { key: 'Escape' });
        const phraseHeading = await screen.findByRole('heading', { name: 'Write down your recovery phrase' });
        expect(phraseHeading).toHaveFocus();
        expect(onBack).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous step' }));
        const passwordHeading = await screen.findByRole('heading', { name: 'Create a new wallet' });
        expect(passwordHeading).toHaveFocus();
        expect(screen.getByLabelText('Wallet name')).toHaveValue('Travel wallet');
        expect(screen.getByRole('radio', { name: /^24 words/ })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Use a BIP39 passphrase/ })).toBeChecked();
        expect(screen.getByLabelText('Password')).toHaveValue('');
        expect(screen.getByLabelText('Confirm password')).toHaveValue('');
        expect(screen.getByLabelText('BIP39 passphrase')).toHaveValue('');
        expect(screen.getByLabelText('Confirm passphrase')).toHaveValue('');
        expect(onBack).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Back to wallet setup' }));
        expect(onBack).toHaveBeenCalledOnce();
    });
});

describe('import onboarding keyboard flow', () => {
    it('focuses each lane heading, follows tab order, and imports on Enter only when valid', async () => {
        let finishImport;
        const importMnemonic = vi.fn(() => new Promise((resolve) => { finishImport = resolve; }));
        renderImport({ importMnemonic });

        const heading = screen.getByRole('heading', { name: 'Import an existing wallet' });
        await waitFor(() => expect(heading).toHaveFocus());

        const expectedTabOrder = [
            screen.getByRole('tab', { name: 'Recovery phrase' }),
            screen.getByRole('tab', { name: 'Encrypted backup' }),
            screen.getByRole('button', { name: 'Paste recovery phrase from clipboard' }),
            screen.getByRole('button', { name: 'Scan QR' }),
            screen.getByLabelText('Recovery phrase'),
            screen.getByLabelText('Wallet name'),
            screen.getByLabelText('Password'),
            screen.getByLabelText('Confirm password'),
            screen.getByRole('checkbox', { name: /wallet uses a BIP39 passphrase/ }),
            screen.getByRole('button', { name: 'BIP39 passphrase help' }),
        ];
        for (const control of expectedTabOrder) {
            pressTab();
            expect(control).toHaveFocus();
        }

        pressEnter(screen.getByLabelText('Confirm password'));
        expect(importMnemonic).not.toHaveBeenCalled();
        expect(heading).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } });
        pressEnter(screen.getByLabelText('Confirm password'));
        expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters');
        expect(importMnemonic).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        pressTab();
        expect(screen.getByRole('button', { name: 'Import' })).toHaveFocus();
        pressEnter(screen.getByLabelText('Confirm password'));
        expect(importMnemonic).toHaveBeenCalledOnce();

        finishImport({});
        const noticeHeading = await screen.findByRole('heading', { name: 'Automatic Donation System' });
        expect(noticeHeading).toHaveFocus();
    });

    it('returns with Escape or Back while retaining the name and clearing secret fields', async () => {
        const onBack = vi.fn();
        renderImport({ onBack });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Import an existing wallet' })).toHaveFocus());

        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));
        const backupHeading = screen.getByRole('heading', { name: 'Restore from encrypted backup' });
        await waitFor(() => expect(backupHeading).toHaveFocus());
        fireEvent.click(screen.getByRole('tab', { name: 'Recovery phrase' }));
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Import an existing wallet' })).toHaveFocus());

        fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: 'Recovered wallet' } });
        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('checkbox', { name: /wallet uses a BIP39 passphrase/ }));
        fireEvent.change(screen.getByLabelText('BIP39 passphrase'), { target: { value: 'hidden phrase' } });

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onBack).toHaveBeenCalledOnce();
        expect(screen.getByLabelText('Wallet name')).toHaveValue('Recovered wallet');
        expect(screen.getByLabelText('Recovery phrase')).toHaveValue('');
        expect(screen.getByLabelText('Password')).toHaveValue('');
        expect(screen.getByLabelText('Confirm password')).toHaveValue('');
        expect(screen.getByLabelText('BIP39 passphrase')).toHaveValue('');

        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fireEvent.click(screen.getByRole('button', { name: 'Back to wallet setup' }));
        expect(onBack).toHaveBeenCalledTimes(2);
        expect(screen.getByLabelText('Wallet name')).toHaveValue('Recovered wallet');
        expect(screen.getByLabelText('Recovery phrase')).toHaveValue('');
    });
});
