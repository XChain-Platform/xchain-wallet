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
    it('keeps Next enabled with no standing hint and names each missing field on press (G22)', () => {
        draw();
        const action = screen.getByRole('button', { name: 'Next' });

        expect(action).toBeEnabled();
        expect(action).not.toHaveAttribute('aria-describedby');
        expect(screen.queryByText(/to continue\.$/)).toBeNull();

        // The form error standard: one press lists every problem at the top
        // and outlines every failing field.
        fireEvent.click(action);
        const summary = () => screen.getByRole('alert', { name: 'Form errors' });
        expect(summary()).toHaveTextContent('Fix 2 things to continue');
        expect(within(summary()).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            'Password must be at least 8 characters.',
            'Confirm your password.',
        ]);
        expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Confirm')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Wallet name')).not.toHaveAttribute('aria-invalid');

        // Typing in Password clears only that field; Confirm stays marked.
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-enough' } });
        expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid');
        expect(within(summary()).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            'Confirm your password.',
        ]);
        expect(summary()).toHaveTextContent('Fix 1 thing to continue');
        expect(screen.getByLabelText('Confirm')).toHaveAttribute('aria-invalid', 'true');

        // Next validates again.
        fireEvent.click(action);
        expect(within(summary()).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            'Confirm your password.',
        ]);
        expect(generateBip39Mnemonic).not.toHaveBeenCalled();
    });

    it('shows the step count in the header subtitle and no intro note above the fields (G01)', () => {
        draw();
        const step = screen.getByText('Step 1 of 3');
        expect(step).toHaveAttribute('aria-current', 'step');
        expect(step.closest('form')).toBeNull();
        // The only warning line on the page sits inside the closed Extra Passphrase section.
        const lines = [...document.querySelectorAll('form [data-warning-line]')];
        expect(lines.every((l) => l.closest('[data-form-section="extra-passphrase"]'))).toBe(true);
        // G44: the word count is no longer a boxed radio group.
        expect(screen.queryByRole('group', { name: /Recovery phrase length/ })).toBeNull();
    });

    it('explains the word-count tradeoff and generates the selected 24 words', async () => {
        generateBip39Mnemonic.mockReturnValue(phrase24);
        draw();

        // G44: the word count is the icon dropdown, not a radio group.
        const lengthSelect = screen.getByRole('button', { name: 'Recovery phrase length: 12 words' });
        expect(screen.getByText('Recommended: secure and easier to back up')).toBeTruthy();
        expect(document.getElementById('create-password-hint')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'About Password' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent('At least 8 characters; use a unique password, and longer is stronger.');
        fireEvent.click(screen.getByRole('button', { name: 'About Password' }));

        fireEvent.click(lengthSelect);
        expect(screen.getByText('Extra entropy, twice as many words to store')).toBeTruthy();
        fireEvent.click(screen.getByRole('option', { name: /^24 words/ }));
        expect(screen.getByRole('button', { name: 'Recovery phrase length: 24 words' })).toBeTruthy();
        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        expect(generateBip39Mnemonic).toHaveBeenCalledWith(256);
        expect(screen.queryByRole('list', { name: 'Recovery phrase' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Phrase' }));
        const grid = await screen.findByRole('list', { name: 'Recovery phrase' });
        const words = within(grid).getAllByRole('listitem');
        expect(words).toHaveLength(24);
        expect(words[0]).toHaveAccessibleName('1. abandon');
        expect(words[23]).toHaveAccessibleName('24. actual');
        expect(screen.getByText(/never share them with anyone/)).toHaveTextContent(
            'Write these words down, keep them offline, and never share them with anyone.',
        );
        expect(screen.queryByText(/ONLY way/)).toBeNull();
    });

    it('opens on the Wallet name field with no intro text and orders the switch row label, help, switch', () => {
        draw();
        const fields = screen.getAllByRole('textbox');
        expect(fields[0]).toHaveAccessibleName('Wallet name');
        // Only the Password field's tooltip (hidden until asked for) carries the sentence.
        expect(screen.queryByText(/Your password encrypts this wallet/, { ignore: '[role="tooltip"]' })).toBeNull();
        // The explanation lives in the password field's help tip.
        expect(screen.getByRole('button', { name: 'About Password' })).toBeTruthy();

        const toggle = screen.getByRole('switch', { name: /^Use an extra passphrase/, hidden: true });
        const help = screen.getByRole('button', { name: 'About Use an extra passphrase', hidden: true });
        const label = screen.getByText('Use an extra passphrase');
        const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
        expect(label.compareDocumentPosition(help) & FOLLOWING).toBeTruthy();
        expect(help.compareDocumentPosition(toggle) & FOLLOWING).toBeTruthy();
    });

    it('keeps the Extra Passphrase section closed until opened, with its fields inactive until the switch is on', () => {
        draw();
        const header = screen.getByRole('button', { name: /^Extra Passphrase/ });
        expect(header).toHaveAttribute('aria-expanded', 'false');
        expect(header).toHaveTextContent('Off');
        expect(screen.queryByRole('switch', { name: /^Use an extra passphrase/ })).toBeNull();

        fireEvent.click(header);
        expect(header).toHaveAttribute('aria-expanded', 'true');
        const toggle = screen.getByRole('switch', { name: /^Use an extra passphrase/ });
        // The fields are always shown inside the section, inactive while the switch is off.
        expect(screen.getByLabelText('Extra passphrase')).toBeDisabled();
        expect(screen.getByLabelText('Confirm passphrase')).toBeDisabled();

        fireEvent.click(toggle);
        expect(screen.getByLabelText('Extra passphrase')).not.toBeDisabled();
        expect(screen.getByLabelText('Confirm passphrase')).not.toBeDisabled();
        fireEvent.click(header);
        expect(header).toHaveTextContent('On');
    });

    it('shows the red warning first in the open section whether the switch is on or off, with fields in place', () => {
        draw();
        const header = screen.getByRole('button', { name: /^Extra Passphrase/ });
        // The section title carries the shared Optional pill.
        expect(header.querySelector('[data-optional-pill]')).toHaveTextContent('Optional');
        fireEvent.click(header);

        // The red danger notice (Notice Standard), and the section body that holds it.
        const warning = () => screen.getByText(/Save this passphrase separately/).closest('[data-tone="danger"]');
        const body = () => warning().parentElement;

        for (const on of [false, true]) {
            const toggle = screen.getByRole('switch', { name: /^Use an extra passphrase/ });
            if (toggle.checked !== on) fireEvent.click(toggle);
            expect(body().firstElementChild).toBe(warning());
            expect(body().contains(screen.getByRole('switch', { name: /^Use an extra passphrase/ }))).toBe(true);
            expect(warning().compareDocumentPosition(screen.getByRole('switch', { name: /^Use an extra passphrase/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            const pass = screen.getByLabelText('Extra passphrase');
            const confirm = screen.getByLabelText('Confirm passphrase');
            expect(pass).toBeInTheDocument();
            expect(confirm).toBeInTheDocument();
            if (on) {
                expect(pass).not.toBeDisabled();
            } else {
                expect(pass).toBeDisabled();
                expect(confirm).toBeDisabled();
            }
        }
    });

    it('gives both recovery phrase length options the same neutral icon, never a lock', () => {
        draw();
        const lockSvg = screen.getByRole('button', { name: /^Extra Passphrase/ }).querySelector('svg');
        expect(lockSvg).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Recovery phrase length: 12 words' }));
        const iconOf = (re) => screen.getByRole('option', { name: re }).querySelector('svg');
        const a = iconOf(/^12 words/);
        const b = iconOf(/^24 words/);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a.innerHTML).toBe(b.innerHTML);
        expect(a.innerHTML).not.toBe(lockSvg.innerHTML);
    });

    it('warns that the enabled BIP39 passphrase is required and exact', async () => {
        draw();
        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: /^Extra Passphrase/ }));
        fireEvent.click(screen.getByRole('switch', {
            name: /^Use an extra passphrase/,
        }));

        expect(screen.getByText(/Save this passphrase separately/)).toHaveTextContent(
            /missing or mistyped passphrase opens a different wallet without warning/,
        );
        // The warning says it once; the field hint does not repeat it.
        expect(screen.getAllByText(/Capitalization and spaces matter/)).toHaveLength(1);
        expect(screen.getByText(/Save this passphrase separately/)).toHaveTextContent(
            /Capitalization and spaces matter/,
        );
        expect(screen.getByText('Required when enabled.')).toBeTruthy();
        fireEvent.focus(screen.getByRole('button', { name: 'About Use an extra passphrase' }));
        const tip = (await screen.findByRole('tooltip')).textContent;
        expect(tip).toMatch(/extra secret combines with your recovery phrase/i);
        expect(tip).toMatch(/hardware wallets handle it on the device/i);
        expect(tip.match(/[.!?](?:\s|$)/g)).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        // Listed in the error notice and under the field, which is outlined.
        const summary = await screen.findByRole('alert', { name: 'Form errors' });
        expect(summary).toHaveTextContent(/Enter the extra passphrase, or uncheck the box/);
        expect(screen.getByLabelText('Extra passphrase')).toHaveAttribute('aria-invalid', 'true');
        expect(generateBip39Mnemonic).not.toHaveBeenCalled();
    });

    it('renders phrase display and confirmation actions inside the scrolling screen', async () => {
        generateBip39Mnemonic.mockReturnValue(phrase24.split(' ').slice(0, 12).join(' '));
        const { container } = draw();
        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        const main = container.querySelector('main');
        fireEvent.click(await screen.findByRole('button', { name: 'Reveal Recovery Phrase' }));
        const phrase = await screen.findByRole('list', { name: 'Recovery phrase' });
        const verify = screen.getByRole('button', { name: 'Verify Recovery Phrase' });
        expect(main).toContainElement(phrase);
        expect(main).toContainElement(verify);

        fireEvent.click(screen.getByRole('checkbox', { name: /saved my recovery phrase/i }));
        fireEvent.click(verify);

        expect(within(main).queryByRole('button', { name: 'Back' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Back to previous step' }).closest('header'))
            .not.toBeNull();
        expect(main).toContainElement(within(main).getByRole('button', { name: 'Create Wallet' }));
        expect(screen.getAllByLabelText(/^Word \d+$/)).toHaveLength(3);
        // The title and the Word N fields say enough: no intro notice above them.
        expect(screen.queryByText(/Enter the requested words/)).toBeNull();
        expect(document.querySelector('form [data-variant="warning"], form [data-tone="danger"]')).toBeNull();
    });

    it('rejects the acknowledgement until the phrase is revealed', () => {
        generateBip39Mnemonic.mockReturnValue(phrase24.split(' ').slice(0, 12).join(' '));
        draw();
        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        const checkbox = screen.getByRole('checkbox', { name: /saved my recovery phrase/i });
        fireEvent.click(checkbox);

        expect(checkbox).not.toBeChecked();
        expect(checkbox).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Reveal your recovery phrase and write it down first.')).toBeInTheDocument();
        expect(screen.queryByRole('alert', { name: 'Form errors' })).toBeNull();
    });

    it('keeps Verify on the phrase step and shows the reveal reason in the top summary', () => {
        generateBip39Mnemonic.mockReturnValue(phrase24.split(' ').slice(0, 12).join(' '));
        const { container } = draw();
        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        const main = container.querySelector('main');
        main.scrollTop = 400;

        fireEvent.click(screen.getByRole('button', { name: 'Verify Recovery Phrase' }));

        const summary = screen.getByRole('alert', { name: 'Form errors' });
        expect(summary).toHaveTextContent('Reveal your recovery phrase and write it down first.');
        expect(summary).toHaveFocus();
        expect(main.scrollTop).toBe(0);
        expect(screen.getByRole('heading', { name: 'Recovery Phrase' })).toBeInTheDocument();
        expect(screen.queryByLabelText(/^Word \d+$/)).toBeNull();
    });

    it('allows acknowledgement and verification after Reveal', () => {
        generateBip39Mnemonic.mockReturnValue(phrase24.split(' ').slice(0, 12).join(' '));
        draw();
        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Phrase' }));
        const checkbox = screen.getByRole('checkbox', { name: /saved my recovery phrase/i });

        fireEvent.click(checkbox);
        expect(checkbox).toBeChecked();
        expect(checkbox).not.toHaveAttribute('aria-invalid', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Verify Recovery Phrase' }));

        expect(screen.getByRole('heading', { name: 'Verify Phrase' })).toBeInTheDocument();
        expect(screen.getAllByLabelText(/^Word \d+$/)).toHaveLength(3);
    });

    it('keeps the phrase warning and each action next to the content it governs', () => {
        generateBip39Mnemonic.mockReturnValue(phrase24.split(' ').slice(0, 12).join(' '));
        const { container } = draw();
        fillPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        // One compact shared danger notice (U71, the Notice Standard): a
        // single sentence, no separate lines, not a live region.
        expect(container.querySelector('[data-warning-line]')).toBeNull();
        const notices = container.querySelectorAll('[data-tone="danger"]');
        expect(notices).toHaveLength(1);
        expect(notices[0]).toHaveTextContent(
            'Write these words down, keep them offline, and never share them with anyone.',
        );
        expect(notices[0].querySelector('strong, em, b, [class*="critical"]')).toBeNull();
        expect(screen.queryByText(/Never share your recovery phrase/)).toBeNull();

        const card = container.querySelector('[data-mnemonic-card]');
        const copyNote = screen.getByText(
            'Copying is disabled to keep your recovery phrase out of shared clipboards.',
        );
        expect(card.nextElementSibling).toBe(copyNote);

        const checkbox = screen.getByRole('checkbox', { name: /saved my recovery phrase/i });
        const verify = screen.getByRole('button', { name: 'Verify Recovery Phrase' });
        expect(checkbox.closest('label').nextElementSibling).toBe(verify);

        fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Phrase' }));
        fireEvent.click(checkbox);
        fireEvent.click(verify);

        const lastWord = screen.getAllByLabelText(/^Word \d+$/).at(-1);
        const create = screen.getByRole('button', { name: 'Create Wallet' });
        expect(lastWord.closest('ol').nextElementSibling).toBe(create);
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

    it('reveals the phrase inside its card once and prevents copying it', () => {
        const view = render(<MnemonicGrid mnemonic="abandon ability able about" variant="small" />);

        const reveal = screen.getByRole('button', { name: 'Reveal Recovery Phrase' });
        const card = view.container.querySelector('[data-mnemonic-card]');
        expect(card).toContainElement(reveal);
        expect(reveal).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('abandon')).toBeNull();
        expect(screen.queryByRole('list', { name: 'Recovery phrase' })).toBeNull();

        fireEvent.click(reveal);

        const grid = screen.getByRole('list', { name: 'Recovery phrase' });
        expect(card).toContainElement(grid);
        expect(screen.queryByRole('button', { name: 'Reveal Recovery Phrase' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Hide recovery phrase' })).toBeNull();
        expect(within(grid).getAllByRole('listitem')[0]).toHaveAccessibleName('1. abandon');
        expect(fireEvent.copy(grid)).toBe(false);

        view.rerender(<MnemonicGrid mnemonic="abandon ability able about" variant="small" />);
        expect(screen.getByText('abandon')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reveal Recovery Phrase' })).toBeNull();
    });

    it('requires a fresh reveal when returning to an earlier phrase', () => {
        const view = render(<MnemonicGrid mnemonic="abandon ability able about" />);

        fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Phrase' }));
        expect(screen.getByText('abandon')).toBeInTheDocument();

        view.rerender(<MnemonicGrid mnemonic="zoo zone zero zebra" />);
        expect(screen.queryByText('zoo')).not.toBeInTheDocument();

        view.rerender(<MnemonicGrid mnemonic="abandon ability able about" />);
        expect(screen.queryByText('abandon')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reveal Recovery Phrase' }))
            .toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps onboarding controls contained and compact in short landscape screens', () => {
        const onboardingCss = css('packages/core/src/shared/routes/Onboarding.module.css');
        const createCss = css('packages/core/src/shared/routes/CreateWallet.module.css');
        const importCss = css('packages/core/src/shared/routes/ImportWallet.module.css');
        const screenCss = css('packages/core/src/ui/Screen.module.css');

        // Onboarding actions live in FormPage now; the route keeps only its artwork rules.
        expect(onboardingCss).not.toMatch(/\.actionsFull/);
        expect(onboardingCss).toMatch(/@media \(max-height:\s*520px\)/);
        // The word-count choice is the shared IconSelect (G44), so the route
        // keeps no boxed radio-group rules of its own.
        expect(createCss).not.toMatch(/\.wordCountRow/);
        expect(createCss).toMatch(/\.confirmRow\s*>\s*span\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
        // The checkbox shares the phrase stack, so its gaps above and below are 8px.
        expect(createCss).toMatch(/\.phraseStack,\s*\.quizActions\s*\{[^}]*gap:\s*var\(--xc-space-2\);/s);
        expect(createCss).not.toMatch(/\.confirmActions/);
        expect(createCss).toMatch(/\.confirmRow\s*\{[^}]*margin:\s*0;/s);
        // The extra-passphrase row is the shared Switch with its own help tip, so no route rule.
        expect(createCss).not.toMatch(/\.advancedToggle/);
        expect(createCss).toMatch(/@media \(max-height:\s*520px\)/);
        // Import's backup summary card shrinks with the screen instead of overflowing it.
        expect(importCss).toMatch(/\.backupCard\s*\{[^}]*min-width:\s*0;/s);
        expect(importCss).toMatch(/\.advancedToggle\s*>\s*span\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s);
        // The import lane switcher is the kit Tabs bar: it fills the row and
        // scrolls its tabs instead of letting them push the screen wider.
        // Tabs draw the shared view-toggle frame from the SegmentedControl sheet.
        const tabsCss = readFileSync(resolve(process.cwd(), 'packages/core/src/ui/SegmentedControl.module.css'), 'utf8');
        expect(tabsCss).toMatch(/\.segmented\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto;/s);
        expect(screenCss).toMatch(/\.body\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s);
    });
});
