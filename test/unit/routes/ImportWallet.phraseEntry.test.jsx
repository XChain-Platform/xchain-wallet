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
    it('normalizes spaces and newlines when a whole phrase is pasted', async () => {
        const importMnemonic = renderImport();
        const textarea = screen.getByLabelText('Recovery phrase');
        fireEvent.paste(textarea, {
            clipboardData: {
                getData: () => `  abandon  abandon\nabandon\tabandon abandon abandon\n abandon abandon abandon abandon abandon about  `,
            },
        });

        expect(textarea).toHaveValue(BIP39_PHRASE);
        expect(screen.getByText('12 words entered (use 12, 15, 18, 21, or 24)')).toBeTruthy();
        expect(screen.getByText('BIP39 recovery phrase detected')).toBeTruthy();

        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(importMnemonic).toHaveBeenCalledWith(
            expect.objectContaining({ mnemonic: BIP39_PHRASE }),
        ));
    });

    it('splits a multi-line clipboard phrase into words', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn().mockResolvedValue(
                    '  abandon  abandon\nabandon\tabandon abandon abandon\n abandon abandon abandon abandon abandon about  ',
                ),
            },
        });
        renderImport();

        fireEvent.click(screen.getByRole('button', { name: 'Paste recovery phrase from clipboard' }));

        await waitFor(() => expect(screen.getByLabelText('Recovery phrase')).toHaveValue(BIP39_PHRASE));
        expect(screen.getByText('12 words entered (use 12, 15, 18, 21, or 24)')).toBeTruthy();
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
            'Unknown recovery phrase word "notaword". Check its spelling.',
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
        expect(screen.getByText('24 words entered (use 12, 15, 18, 21, or 24)')).toBeTruthy();
        expect(screen.getByText('BIP39 recovery phrase detected')).toBeTruthy();
    });

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
