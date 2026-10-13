// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MnemonicGrid } from '../../../packages/core/src/shared/components/MnemonicGrid.jsx';
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

const css = (path) => readFileSync(resolve(path), 'utf8');

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
    it('explains each missing password field beside the disabled primary action', () => {
        draw();
        const action = screen.getByRole('button', { name: 'Next' });

        expect(action).toBeDisabled();
        expect(action).toHaveAttribute('aria-describedby', 'create-wallet-disabled-reason');
        expect(screen.getByRole('status')).toHaveTextContent('Enter a password to continue.');

        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-enough' } });
        expect(action).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Confirm your password to continue.');

        fireEvent.change(screen.getByLabelText('Confirm'), { target: { value: 'long-enough' } });
        expect(action).toBeEnabled();
        expect(action).not.toHaveAttribute('aria-describedby');
    });

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
        expect(screen.queryByRole('list', { name: 'Recovery phrase' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
        const grid = await screen.findByRole('list', { name: 'Recovery phrase' });
        const words = within(grid).getAllByRole('listitem');
        expect(words).toHaveLength(24);
        expect(words[0]).toHaveAccessibleName('1. abandon');
        expect(words[23]).toHaveAccessibleName('24. actual');
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

    it('renders phrase display and confirmation actions inside the scrolling screen', async () => {
        generateBip39Mnemonic.mockReturnValue(phrase24.split(' ').slice(0, 12).join(' '));
        const { container } = draw();
        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        const main = container.querySelector('main');
        fireEvent.click(await screen.findByRole('button', { name: 'Reveal recovery phrase' }));
        const phrase = await screen.findByRole('list', { name: 'Recovery phrase' });
        const verify = screen.getByRole('button', { name: 'Verify recovery phrase' });
        expect(main).toContainElement(phrase);
        expect(main).toContainElement(verify);

        fireEvent.click(screen.getByRole('checkbox', { name: /saved my recovery phrase/i }));
        fireEvent.click(verify);

        expect(main).toContainElement(within(main).getByRole('button', { name: 'Back' }));
        expect(main).toContainElement(within(main).getByRole('button', { name: 'Create wallet' }));
        expect(screen.getAllByLabelText(/^Word \d+$/)).toHaveLength(3);
    });
});

describe('MnemonicGrid narrow layout', () => {
    it('keeps numbered whole words in two columns at 320px without selection', () => {
        const gridCss = css('packages/core/src/shared/components/MnemonicGrid.module.css');
        const popupRule = gridCss.match(/\.gridPopup\s*\{([^}]*)\}/)?.[1];
        const fullRule = gridCss.match(/\.gridFull\s*\{([^}]*)\}/)?.[1];
        const cellRule = gridCss.match(/\.cell\s*\{([^}]*)\}/)?.[1];
        const indexRule = gridCss.match(/\.index\s*\{([^}]*)\}/)?.[1];
        const wordRule = gridCss.match(/\.word\s*\{([^}]*)\}/)?.[1];

        expect(popupRule).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
        expect(fullRule).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
        expect(popupRule).toMatch(/width:\s*100%/);
        expect(fullRule).toMatch(/width:\s*100%/);
        expect(cellRule).toMatch(/min-width:\s*0/);
        expect(cellRule).toMatch(/user-select:\s*none/);
        expect(indexRule).toMatch(/flex:\s*0 0 2ch/);
        expect(indexRule).toMatch(/font-weight:\s*600/);
        expect(wordRule).toMatch(/white-space:\s*nowrap/);
        expect(wordRule).toMatch(/word-break:\s*keep-all/);
        expect(gridCss).not.toMatch(/user-select:\s*all/);
        expect(gridCss).not.toMatch(/overflow-wrap:\s*anywhere/);
        expect(gridCss).toMatch(/@media not all and \(min-width:\s*360px\)/);
    });

    it('requires a reveal action and prevents copying the revealed phrase', () => {
        render(<MnemonicGrid mnemonic="abandon ability able about" variant="small" />);

        const reveal = screen.getByRole('button', { name: 'Reveal recovery phrase' });
        expect(reveal).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('abandon')).toBeNull();
        expect(screen.queryByRole('list', { name: 'Recovery phrase' })).toBeNull();

        fireEvent.click(reveal);

        const grid = screen.getByRole('list', { name: 'Recovery phrase' });
        expect(screen.getByRole('button', { name: 'Hide recovery phrase' }))
            .toHaveAttribute('aria-expanded', 'true');
        expect(within(grid).getAllByRole('listitem')[0]).toHaveAccessibleName('1. abandon');
        expect(fireEvent.copy(grid)).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: 'Hide recovery phrase' }));
        expect(screen.queryByText('abandon')).toBeNull();
    });

    it('keeps onboarding controls contained and compact in short landscape screens', () => {
        const onboardingCss = css('packages/core/src/shared/routes/Onboarding.module.css');
        const createCss = css('packages/core/src/shared/routes/CreateWallet.module.css');
        const importCss = css('packages/core/src/shared/routes/ImportWallet.module.css');
        const screenCss = css('packages/core/src/ui/Screen.module.css');

        expect(onboardingCss).toMatch(/\.actionsFull\s*\{[^}]*width:\s*100%;/s);
        expect(onboardingCss).toMatch(/@media \(max-height:\s*520px\)/);
        expect(createCss).toMatch(/\.wordCountOption\s*\{[^}]*flex-wrap:\s*wrap;/s);
        expect(createCss).toMatch(/@media \(max-height:\s*520px\)/);
        expect(importCss).toMatch(/\.mnemonicHeader\s*\{[^}]*flex-wrap:\s*wrap;/s);
        expect(importCss).toMatch(/\.laneTab\s*\{[^}]*min-width:\s*0;/s);
        expect(screenCss).toMatch(/\.body\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s);
    });
});
