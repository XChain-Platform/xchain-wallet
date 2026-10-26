// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const BIP39_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BIP39_PHRASES = [
    BIP39_PHRASE,
    `${Array(14).fill('abandon').join(' ')} address`,
    `${Array(17).fill('abandon').join(' ')} agent`,
    `${Array(20).fill('abandon').join(' ')} admit`,
    `${Array(23).fill('abandon').join(' ')} art`,
];
const BIP39_24_WORD_PHRASE = `${Array(23).fill('abandon').join(' ')} art`;
const COUNTERWALLET_PHRASE = 'explode gaze wolf admit nice charm except three any guitar into color';
const PASSWORD = 'correct-horse-battery';

afterEach(() => {
    delete navigator.clipboard;
});

function renderImport(importMnemonic = vi.fn().mockResolvedValue({})) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />
        </MessagingProvider>,
    );
    return importMnemonic;
}

function renderFreeWallet(importMnemonic = vi.fn().mockResolvedValue({})) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <ImportWallet
                onBack={() => {}}
                onImported={() => {}}
                mode="fresh"
                variant="freewallet"
            />
        </MessagingProvider>,
    );
    return importMnemonic;
}

function fillPasswords() {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
}

function submitPhrase(phrase, importMnemonic = vi.fn().mockResolvedValue({})) {
    renderImport(importMnemonic);
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: phrase } });
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    return importMnemonic;
}

describe('ImportWallet recovery phrase entry', () => {
    it('keeps the secret phrase field out of autofill, spellcheck, autocapitalize and autocorrect', () => {
        renderImport();
        const phrase = screen.getByLabelText('Recovery phrase');
        expect(phrase.tagName).toBe('TEXTAREA');
        expect(phrase).toHaveAttribute('autocomplete', 'off');
        expect(phrase).toHaveAttribute('spellcheck', 'false');
        expect(phrase).toHaveAttribute('autocapitalize', 'off');
        expect(phrase).toHaveAttribute('autocorrect', 'off');
    });

    it('names the next missing field beside the disabled import action', () => {
        renderImport();
        const action = screen.getByRole('button', { name: 'Import' });
        const phrase = screen.getByLabelText('Recovery phrase');

        expect(phrase).toHaveAccessibleDescription(/Enter a BIP39 recovery phrase with 12, 15, 18, 21, or 24 words/);
        expect(action).toBeDisabled();
        expect(action).toHaveAttribute('aria-describedby', 'import-wallet-disabled-reason');
        expect(screen.getByRole('status')).toHaveTextContent('Enter a recovery phrase to continue.');

        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: BIP39_PHRASE } });
        expect(screen.getByRole('status')).toHaveTextContent('Enter a password to continue.');

        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        expect(screen.getByRole('status')).toHaveTextContent('Confirm your password to continue.');

        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        expect(action).toBeEnabled();
        expect(action).not.toHaveAttribute('aria-describedby');
    });

    it('names the accepted word counts once, in the hint and not again in the live count', () => {
        renderImport();
        const description = screen.getByLabelText('Recovery phrase').getAttribute('aria-describedby')
            .split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ');
        expect(description.match(/12, 15, 18, 21, or 24/g)).toHaveLength(1);
        expect(screen.getByText('0 words entered')).toBeTruthy();
    });

    it('normalizes spaces and newlines when a whole phrase is pasted', async () => {
        const importMnemonic = renderImport();
        const textarea = screen.getByLabelText('Recovery phrase');
        fireEvent.paste(textarea, {
            clipboardData: {
                getData: () => `  abandon  abandon\nabandon\tabandon abandon abandon\n abandon abandon abandon abandon abandon about  `,
            },
        });

        expect(textarea).toHaveValue(BIP39_PHRASE);
        expect(screen.getByText('12 words entered')).toBeTruthy();
        expect(screen.getByText('BIP39 recovery phrase detected')).toBeTruthy();

        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(importMnemonic).toHaveBeenCalledWith(
            expect.objectContaining({ mnemonic: BIP39_PHRASE }),
        ));
    });

    it('normalizes upper-case words before import', async () => {
        const importMnemonic = submitPhrase(BIP39_PHRASE.toUpperCase());

        await waitFor(() => expect(importMnemonic).toHaveBeenCalledWith(
            expect.objectContaining({ mnemonic: BIP39_PHRASE }),
        ));
    });

    it.each(BIP39_PHRASES.map((phrase) => [phrase.split(' ').length, phrase]))(
        'imports a valid %i-word BIP39 phrase',
        async (_wordCount, phrase) => {
            const importMnemonic = submitPhrase(phrase);

            await waitFor(() => expect(importMnemonic).toHaveBeenCalledWith(
                expect.objectContaining({ mnemonic: phrase }),
            ));
        },
    );

    it('removes sequential numbering from a pasted recovery phrase', async () => {
        const numbered = BIP39_PHRASE
            .split(' ')
            .map((word, index) => `${index + 1}. ${word}`)
            .join('\n');
        const importMnemonic = renderImport();
        const textarea = screen.getByLabelText('Recovery phrase');

        fireEvent.paste(textarea, {
            clipboardData: { getData: () => numbered },
        });

        expect(textarea).toHaveValue(BIP39_PHRASE);
        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(importMnemonic).toHaveBeenCalledWith(
            expect.objectContaining({ mnemonic: BIP39_PHRASE }),
        ));
    });

    it('offers BIP39 completions for the word at the caret', () => {
        renderImport();
        const textarea = screen.getByLabelText('Recovery phrase');
        fireEvent.change(textarea, { target: { value: 'abandon abou abandon' } });
        textarea.setSelectionRange(12, 12);
        fireEvent.select(textarea);

        fireEvent.click(screen.getByRole('button', { name: 'Use BIP39 word "about"' }));

        expect(textarea).toHaveValue('abandon about abandon');
    });

    it('names a word that belongs to neither supported word list', async () => {
        const phrase = BIP39_PHRASE.replace(/about$/, 'notaword');
        const importMnemonic = submitPhrase(phrase);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Word 12 ("notaword") is not in the recovery phrase word list. Check its spelling.',
        );
        expect(importMnemonic).not.toHaveBeenCalled();
    });

    it('distinguishes a bad BIP39 checksum from an unknown word', async () => {
        const importMnemonic = submitPhrase(BIP39_PHRASE.replace(/about$/, 'abandon'));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Every word is in the BIP39 list, but the checksum does not match.',
        );
        expect(importMnemonic).not.toHaveBeenCalled();
    });

    it('labels Counterwallet and FreeWallet phrases separately from BIP39', () => {
        renderImport();
        const textarea = screen.getByLabelText('Recovery phrase');

        fireEvent.change(textarea, { target: { value: COUNTERWALLET_PHRASE } });
        expect(screen.getByText('Counterwallet/FreeWallet recovery phrase detected')).toBeTruthy();

        fireEvent.change(textarea, { target: { value: BIP39_PHRASE } });
        expect(screen.getByText('BIP39 recovery phrase detected')).toBeTruthy();

        fireEvent.change(textarea, { target: { value: BIP39_24_WORD_PHRASE } });
        expect(screen.getByText('24 words entered')).toBeTruthy();
        expect(screen.getByText('BIP39 recovery phrase detected')).toBeTruthy();
    });

    it.each([['import', renderImport], ['FreeWallet import', renderFreeWallet]])(
        'puts Scan QR inside the %s phrase box, with the live count below the hint',
        (_name, renderScreen) => {
            renderScreen();
            const textarea = screen.getByLabelText('Recovery phrase');
            const box = textarea.parentElement;
            const scan = screen.getByRole('button', { name: 'Scan QR', exact: true });

            expect(box.contains(scan)).toBe(true);
            expect(textarea.compareDocumentPosition(scan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            // Nothing sits beside the label any more.
            expect(document.querySelector('label[for="xc-mnemonic"]').parentElement.querySelector('button')).toBeNull();

            const status = document.getElementById('xc-mnemonic-status');
            const hint = document.getElementById(`${textarea.id}-hint`);
            expect(box.contains(status)).toBe(false);
            expect(hint.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(status).toHaveTextContent(/0 (\/ 12 )?words/);

            fireEvent.click(scan);
            expect(screen.getByRole('button', { name: 'Cancel scan', exact: true })).toHaveAttribute('aria-pressed', 'true');
        },
    );

    it('explains FreeWallet format detection and shows its 12-word target', () => {
        renderFreeWallet();
        expect(screen.getByText(/detect BIP39 or the legacy Counterwallet\/FreeWallet format automatically/)).toBeTruthy();
        expect(screen.getByText('0 / 12 words')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Recovery phrase'), {
            target: { value: COUNTERWALLET_PHRASE },
        });
        expect(screen.getByText('12 / 12 words')).toBeTruthy();
        expect(screen.getByText('Counterwallet/FreeWallet recovery phrase detected')).toBeTruthy();
    });
});
