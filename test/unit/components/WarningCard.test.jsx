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
import { cleanup, render, screen } from '@testing-library/react';
import { BodyParagraph, WarningCard, WarningLine } from '../../../packages/core/src/shared/components/WarningCard.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { RECOVERY_PHRASE_WARNING } from '../../../packages/core/src/shared/utils/securityMomentCopy.js';

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
    it('draws plain and critical lines inside one card', () => {
        render(
            <WarningCard data-testid="card">
                <WarningLine>You are about to see a secret.</WarningLine>
                <WarningLine critical>Never share it.</WarningLine>
            </WarningCard>,
        );
        const card = screen.getByTestId('card');
        const plain = screen.getByText('You are about to see a secret.');
        const critical = screen.getByText('Never share it.');

        expect(card).toContainElement(plain);
        expect(card).toContainElement(critical);
        expect(plain.tagName).toBe('P');
        expect(plain).toHaveAttribute('data-warning-line', 'plain');
        expect(critical).toHaveAttribute('data-warning-line', 'critical');
        expect(critical.className).not.toBe(plain.className);
    });

    it('starts every line at the start edge and never justifies it', () => {
        expect(rule(warningCss, '.paragraph')).toMatch(/text-align:\s*start/);
        expect(warningCss).not.toMatch(/justify/);
        // The critical line is a red-edged callout built on the plain line.
        const critical = rule(warningCss, '.critical');
        expect(critical).toMatch(/composes:\s*paragraph/);
        expect(critical).toMatch(/border-inline-start:[^;]*var\(--xc-danger\)/);
        expect(critical).toMatch(/background:\s*var\(--xc-danger-bg\)/);
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
        expect(rule(onboardingCss, '.licenseParagraphCritical'))
            .toMatch(/composes:\s*critical from '\.\.\/components\/WarningCard\.module\.css'/);
    });

    it('is what the Upgrade Wallet explanation uses instead of inline styles', () => {
        const source = read('packages/core/src/shared/routes/MigrateToBip39.jsx');
        expect(source).toContain("from '../components/WarningCard.module.css'");
        expect(source).toMatch(/<p className=\{paragraphStyles\.body\}>/);
        expect(source).not.toMatch(/<p style=\{/);
    });
});

describe('Show Recovery Phrase warning', () => {
    it('uses the shared card with the phrase and screen-sharing lines as critical callouts', () => {
        render(
            <MessagingProvider shell="web" messaging={{ revealMnemonicRequest: vi.fn() }}>
                <ViewRecoveryPhrase walletId="wallet-1" walletName="Savings" onBack={() => {}} />
            </MessagingProvider>,
        );

        const phraseLine = screen.getByText(RECOVERY_PHRASE_WARNING);
        const sharingLine = screen.getByText(/If you are screen-sharing or recording, stop now/);
        const intro = screen.getByText(/You are about to see the recovery phrase for/);

        expect(phraseLine).toHaveAttribute('data-warning-line', 'critical');
        expect(sharingLine).toHaveAttribute('data-warning-line', 'critical');
        expect(intro).toHaveAttribute('data-warning-line', 'plain');
        // All three lines sit in the one card.
        expect(intro.parentElement).toBe(phraseLine.parentElement);
        expect(intro.parentElement).toBe(sharingLine.parentElement);
    });
});
