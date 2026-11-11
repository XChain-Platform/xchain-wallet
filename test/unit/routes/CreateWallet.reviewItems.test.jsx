// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Create wallet steps: every field label carries its help tip with no static
// hint under the field, the recovery phrase step keeps its word card at every
// width and a green Verify action, and each verify word has its own tip.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import formStyles from '../../../packages/core/src/ui/FormPage.module.css';

const { generateBip39Mnemonic, phrase12 } = vi.hoisted(() => ({
    generateBip39Mnemonic: vi.fn(),
    phrase12: [
        'abandon', 'ability', 'able', 'about', 'above', 'absent',
        'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
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

function toPhraseStep() {
    generateBip39Mnemonic.mockReturnValue(phrase12);
    draw();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery-staple' } });
    fireEvent.change(screen.getByLabelText('Confirm'), { target: { value: 'correct-horse-battery-staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

afterEach(() => {
    cleanup();
    generateBip39Mnemonic.mockReset();
});

describe('CreateWallet review items', () => {
    it('gives every password step label a help tip and keeps no static hint under Password', () => {
        draw();
        for (const name of ['Wallet name', 'Password', 'Confirm', 'Recovery phrase length']) {
            expect(screen.getByRole('button', { name: `About ${name}` })).toBeTruthy();
        }
        // The tip keeps its text in a hidden description; no hint line is drawn.
        expect(document.getElementById('create-password-hint')).toBeNull();
        expect([...document.querySelectorAll('[id$="-hint"]')]).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: 'About Password' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent('At least 8 characters');
    });

    it('gives the extra passphrase confirm field a help tip', () => {
        draw();
        fireEvent.click(screen.getByRole('switch', { name: /extra passphrase/ }));
        expect(screen.getByRole('button', { name: 'About Confirm passphrase' })).toBeTruthy();
    });

    it('draws the recovery phrase step without the wide form card and with a green Verify action', () => {
        toPhraseStep();
        const verify = screen.getByRole('button', { name: 'Verify recovery phrase' });
        expect(verify).toBeDisabled();
        expect(verify.className.split(' ')).toContain(buttonStyles.success);
        expect(verify.closest('form').className.split(' ')).toContain(formStyles.cardlessForm);
        expect(document.querySelector('[data-mnemonic-card]')).not.toBeNull();
    });

    it('gives each verify word field its own help tip', () => {
        toPhraseStep();
        fireEvent.click(screen.getByRole('checkbox', { name: /saved my recovery phrase/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
        const words = screen.getAllByLabelText(/^Word \d+$/);
        expect(words.length).toBeGreaterThan(0);
        for (const input of words) {
            const n = input.id.replace('create-quiz-word-', '');
            expect(screen.getByRole('button', { name: `About Word ${n}` })).toBeTruthy();
        }
    });
});
