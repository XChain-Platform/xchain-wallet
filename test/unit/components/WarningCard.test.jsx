// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every security warning uses one look, the license screen's: a padded card
// of plain lines with the lines that protect the user's money as red-edged
// callouts. Explanation pages use the same start-aligned line at body size.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BodyParagraph, WarningCard, WarningLine } from '../../../packages/core/src/shared/components/WarningCard.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const { ViewRecoveryPhrase } = await import('../../../packages/core/src/shared/routes/ViewRecoveryPhrase.jsx');

const read = (path) => readFileSync(path, 'utf8');
const rule = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
};
const warningCss = read('packages/core/src/shared/components/WarningCard.module.css');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('WarningCard', () => {
    it('draws a plain line as a paragraph and a critical line as a static danger Notice', () => {
        render(
            <WarningCard data-testid="card">
                <WarningLine>You are about to see a secret.</WarningLine>
                <WarningLine critical>Never share it.</WarningLine>
            </WarningCard>,
        );
        const card = screen.getByTestId('card');
        const plain = screen.getByText('You are about to see a secret.');
        const critical = screen.getByText('Never share it.').closest('[data-warning-line]');

        expect(card).toContainElement(plain);
        expect(card).toContainElement(critical);
        expect(plain.tagName).toBe('P');
        expect(plain).toHaveAttribute('data-warning-line', 'plain');
        expect(critical).toHaveAttribute('data-warning-line', 'critical');
        // Notice Standard (2026-11-15): the danger tone, no live region.
        expect(critical).toHaveAttribute('data-tone', 'danger');
        expect(critical).toHaveAttribute('role', 'note');
        expect(critical).not.toHaveAttribute('aria-live');
    });

    it('starts every line at the start edge and never justifies it', () => {
        expect(rule(warningCss, '.paragraph')).toMatch(/text-align:\s*start/);
        expect(warningCss).not.toMatch(/justify/);
        // A critical line is the shared Notice, so no red edge bar lives here.
        expect(warningCss).not.toMatch(/border-inline-start:[^;]*var\(--xc-danger\)/);
        expect(rule(warningCss, '.critical')).toBe('');
        // The card and explanation paragraphs read at body size.
        expect(rule(warningCss, '.card')).toMatch(/font-size:\s*var\(--xc-text-md\)/);
        expect(rule(warningCss, '.body')).toMatch(/font-size:\s*var\(--xc-text-md\)/);
    });

    it('gives explanation pages the same start-aligned line at body size', () => {
        render(<BodyParagraph>Upgrading creates a new wallet.</BodyParagraph>);
        const paragraph = screen.getByText('Upgrading creates a new wallet.');
        expect(paragraph.tagName).toBe('P');
        expect(paragraph.className).toMatch(/body/);
    });

    it('is the license screen look: the license lines compose the shared lines', () => {
        const onboardingCss = read('packages/core/src/shared/routes/Onboarding.module.css');
        expect(rule(onboardingCss, '.licenseParagraph'))
            .toMatch(/composes:\s*paragraph from '\.\.\/components\/WarningCard\.module\.css'/);
        // A critical license line stays a paragraph of the terms, painted in
        // the Notice Standard danger tone: tint and thin red border, no bar.
        const critical = rule(onboardingCss, '.licenseParagraphCritical');
        expect(critical).toMatch(/composes:\s*paragraph from '\.\.\/components\/WarningCard\.module\.css'/);
        expect(critical).toMatch(/background:\s*var\(--xc-danger-bg\)/);
        expect(critical).toMatch(/border:\s*1px solid var\(--xc-danger\)/);
        expect(critical).not.toMatch(/border-inline-start/);
    });

    it('is what the Upgrade Wallet notes use instead of loose paragraphs', () => {
        // Notes sit only in a warning card, never as loose paragraphs.
        const source = read('packages/core/src/shared/routes/MigrateToBip39.jsx');
        expect(source).toContain("from '../components/WarningCard.jsx'");
        expect(source).toMatch(/<WarningCard\b/);
        expect(source).not.toMatch(/<p\b/);
    });

    it('keeps no critical line inside a card on the secret screens (G120: no box in a card)', () => {
        for (const file of [
            'packages/core/src/shared/routes/ViewPrivateKey.jsx',
            'packages/core/src/shared/routes/MigrateToBip39.jsx',
            'packages/core/src/shared/components/settings/BackupSection.jsx',
            'packages/core/src/shared/routes/VaultUnavailable.jsx',
            'packages/extension/src/approval/kinds/ConnectApproval.jsx',
        ]) {
            expect(read(file), file).not.toMatch(/<WarningLine\s+critical/);
        }
    });
});

describe('Show Recovery Phrase warning', () => {
    it('is one compact warning notice of two plain sentences, with the wallet name in the header', () => {
        const { container } = render(
            <MessagingProvider shell="web" messaging={{ revealMnemonicRequest: vi.fn() }}>
                <ViewRecoveryPhrase walletId="wallet-1" walletName="Savings" onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(container.querySelector('[data-warning-line]')).toBeNull();
        // U71 and the Notice Standard: the recovery phrase warning is red.
        const notices = container.querySelectorAll('[data-tone="danger"]');
        expect(notices).toHaveLength(1);
        expect(notices[0]).toHaveTextContent(
            'Write these words down, keep them offline, and never share them with anyone. '
            + 'If you are screen-sharing or recording, stop now.',
        );
        expect(notices[0]).not.toHaveTextContent(/Savings|Enter your wallet password/);
        expect(screen.getByText('Savings')).toBeInTheDocument();
    });

    const WORDS = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
    const renderPage = (revealMnemonicRequest) => render(
        <MessagingProvider shell="web" messaging={{ revealMnemonicRequest }}>
            <ViewRecoveryPhrase walletId="wallet-1" walletName="Savings" onBack={() => {}} />
        </MessagingProvider>,
    );
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;

    it('puts the password directly under the concealed area and the Reveal button at the bottom of the form', () => {
        renderPage(vi.fn());
        const area = document.querySelector('[data-concealed-area]');
        const field = screen.getByLabelText('Wallet password');
        const button = screen.getByRole('button', { name: 'Reveal Recovery Phrase' });
        expect(area).not.toBeNull();
        expect(area.compareDocumentPosition(field) & FOLLOWING).toBeTruthy();
        expect(field.compareDocumentPosition(button) & FOLLOWING).toBeTruthy();
        // The area carries no button of its own: one Reveal button on the page, with its icon.
        expect(screen.getAllByRole('button', { name: /reveal/i })).toHaveLength(1);
        expect(button.querySelector('svg')).not.toBeNull();
        expect(button.closest('[data-mnemonic-card]')).toBeNull();
        expect(button.closest('form')).not.toBeNull();
        expect(screen.queryByRole('button', { name: /I Understand/i })).toBeNull();
    });

    it('reveals in place when the button is pressed after the password', async () => {
        const revealMnemonicRequest = vi.fn().mockResolvedValue({ mnemonic: WORDS });
        renderPage(revealMnemonicRequest);
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw' } });
        expect(screen.queryByText('abandon')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Phrase' }));

        expect(await screen.findByText('abandon')).toBeInTheDocument();
        expect(revealMnemonicRequest).toHaveBeenCalledTimes(1);
        expect(revealMnemonicRequest).toHaveBeenCalledWith({ walletId: 'wallet-1', password: 'pw' });
        expect(screen.getByText('accident')).toBeInTheDocument();
        // Same page: the warning is still there, no checkbox step, the button is gone.
        expect(screen.getByText(/never share them with anyone/)).toBeInTheDocument();
        expect(screen.queryByRole('checkbox')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Reveal Recovery Phrase' })).toBeNull();
    });

    it('reveals in place when the concealed area is tapped after the password', async () => {
        const revealMnemonicRequest = vi.fn().mockResolvedValue({ mnemonic: WORDS });
        renderPage(revealMnemonicRequest);
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw' } });
        fireEvent.click(document.querySelector('[data-concealed-area]'));

        expect(await screen.findByText('abandon')).toBeInTheDocument();
        expect(revealMnemonicRequest).toHaveBeenCalledTimes(1);
    });

    it('shows no password as the field error from the button and from the area, with no request made', async () => {
        const revealMnemonicRequest = vi.fn();
        renderPage(revealMnemonicRequest);
        fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Phrase' }));
        expect(await screen.findByText('Enter your wallet password.')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'a' } });
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: '' } });
        expect(screen.queryByText('Enter your wallet password.')).toBeNull();
        fireEvent.click(document.querySelector('[data-concealed-area]'));
        expect(await screen.findByText('Enter your wallet password.')).toBeInTheDocument();
        expect(revealMnemonicRequest).not.toHaveBeenCalled();
        expect(document.querySelector('[data-secret]')).toBeNull();
    });

    it('shows a wrong password as the field error in place from the button and from the area, keeping the grid concealed', async () => {
        const err = Object.assign(new Error('bad'), { name: 'WrongPasswordError' });
        const revealMnemonicRequest = vi.fn().mockRejectedValue(err);
        renderPage(revealMnemonicRequest);
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'nope' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Phrase' }));

        expect(await screen.findByText('The wallet password is not right.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reveal Recovery Phrase' })).toBeInTheDocument();
        expect(document.querySelector('[data-secret]')).toBeNull();

        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'nope2' } });
        expect(screen.queryByText('The wallet password is not right.')).toBeNull();
        fireEvent.click(document.querySelector('[data-concealed-area]'));
        expect(await screen.findByText('The wallet password is not right.')).toBeInTheDocument();
        expect(revealMnemonicRequest).toHaveBeenCalledTimes(2);
        expect(document.querySelector('[data-secret]')).toBeNull();
    });
});
