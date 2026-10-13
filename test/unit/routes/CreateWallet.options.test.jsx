// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';

const { generateBip39Mnemonic, phrase24 } = vi.hoisted(() => ({
    generateBip39Mnemonic: vi.fn(),
    phrase24: [
        'abandon', 'ability', 'able', 'about', 'above', 'absent',
        'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
        'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire',
        'across', 'act', 'action', 'actor', 'actress', 'actual',
    ].join(' '),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, crypto: { ...actual.crypto, generateBip39Mnemonic } };
});

function draw() {
    return render(
        <MessagingProvider shell="popup" messaging={{}}>
            <CreateWallet onBack={() => {}} onCreated={() => {}} />
        </MessagingProvider>,
    );
}

function fillPasswords(value = 'correct-horse-battery-staple') {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value } });
    fireEvent.change(screen.getByLabelText('Confirm'), { target: { value } });
}

afterEach(() => {
    cleanup();
    generateBip39Mnemonic.mockReset();
});

describe('CreateWallet security options', () => {
    it('explains the word-count tradeoff and generates the selected 24 words', async () => {
        generateBip39Mnemonic.mockReturnValue(phrase24);
        draw();

        expect(screen.getByRole('radio', { name: /^12 words/ })).toBeChecked();
        expect(screen.getByText('Recommended: secure and easier to back up')).toBeTruthy();
        expect(screen.getByText('Extra entropy, twice as many words to store')).toBeTruthy();
        expect(screen.getByText(/Use a unique password; longer is stronger/)).toBeTruthy();

        fireEvent.click(screen.getByRole('radio', { name: /^24 words/ }));
        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        expect(generateBip39Mnemonic).toHaveBeenCalledWith(256);
        const grid = await screen.findByRole('list', { name: 'Recovery phrase' });
        const words = within(grid).getAllByRole('listitem');
        expect(words).toHaveLength(24);
        expect(words[0].textContent).toBe('1abandon');
        expect(words[23].textContent).toBe('24actual');
        expect(screen.getByText(/Never share your recovery phrase/)).toHaveTextContent(
            'Never share your recovery phrase. Anyone with it can spend your funds.',
        );
        expect(screen.queryByText(/ONLY way/)).toBeNull();
    });

    it('warns that the enabled BIP39 passphrase is required and exact', async () => {
        draw();
        fillPasswords();
        fireEvent.click(screen.getByLabelText(/^Use a BIP39 passphrase \(advanced\)/));

        expect(screen.getByText(/Save this passphrase separately/)).toHaveTextContent(
            /missing or mistyped passphrase opens a different wallet without warning/,
        );
        expect(screen.getByText(/Required when enabled/)).toHaveTextContent(
            /Capitalization and spaces matter/,
        );
        fireEvent.focus(screen.getByRole('button', { name: 'BIP39 passphrase help' }));
        expect(await screen.findByRole('tooltip')).toHaveTextContent(
            /not one of the recovery words.*missing or different passphrase opens a different wallet/i,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        expect(await screen.findByText(/Enter the BIP39 passphrase, or uncheck the box/)).toBeTruthy();
        expect(generateBip39Mnemonic).not.toHaveBeenCalled();
    });
});

describe('MnemonicGrid narrow layout', () => {
    it('keeps numbered words inside two shrinkable columns at 360px', () => {
        const css = readFileSync(
            resolve('packages/core/src/shared/components/MnemonicGrid.module.css'),
            'utf8',
        );
        const popupRule = css.match(/\.gridPopup\s*\{([^}]*)\}/)?.[1];
        const cellRule = css.match(/\.cell\s*\{([^}]*)\}/)?.[1];
        const wordRule = css.match(/\.word\s*\{([^}]*)\}/)?.[1];

        expect(popupRule).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
        expect(cellRule).toMatch(/min-width:\s*0/);
        expect(wordRule).toMatch(/min-width:\s*0/);
        expect(wordRule).toMatch(/overflow-wrap:\s*anywhere/);
    });
});
