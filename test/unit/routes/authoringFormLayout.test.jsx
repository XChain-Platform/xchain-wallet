// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Layout rules shared by the platform authoring forms (Issue token, Token
// wizard and the many screens that reuse IssueTokenForm.module.css).

import { readFileSync } from 'node:fs';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { FormSection } from '../../../packages/core/src/ui/FormSection.jsx';
import { StatusMessage } from '../../../packages/core/src/ui/StatusMessage.jsx';

afterEach(() => cleanup());

const issueCss = readFileSync('packages/core/src/shared/routes/IssueTokenForm.module.css', 'utf8');
const wizardCss = readFileSync('packages/core/src/shared/routes/TokenWizard.module.css', 'utf8');

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

describe('authoring form help text', () => {
    it.each([
        ['IssueTokenForm.module.css', issueCss],
        ['TokenWizard.module.css', wizardCss],
    ])('%s starts .hint at the start edge instead of centring it', (_name, css) => {
        const hint = rule(css, '.hint');
        expect(hint).toMatch(/text-align:\s*start/);
        expect(hint).not.toMatch(/center/);
    });
});

// The form gap token alone spaces the rows of a form. Shared row classes keep
// their margins for result screens, where they follow plain content, and drop
// them inside a form stack (FormPage body, FormSection body).
describe('shared rows add no margin to the form gap', () => {
    const formCss = readFileSync('packages/core/src/ui/FormPage.module.css', 'utf8');

    it('marks the FormPage and FormSection bodies as form stacks', () => {
        render(
            <FormPage label="Form" status={<StatusMessage variant="error">Bad</StatusMessage>}>
                <FormSection title="Part">
                    <p>Field</p>
                </FormSection>
            </FormPage>,
        );
        const section = screen.getByRole('region', { name: 'Part' });
        expect(section.parentElement).toHaveAttribute('data-form-stack');
        expect(screen.getByText('Field').parentElement).toHaveAttribute('data-form-stack');
    });

    it('drops the status-message row margin inside a form stack', () => {
        const body = rule(formCss, '.body > [data-variant],\n.sectionBody > [data-variant],\n.status > [data-variant]');
        expect(body).toMatch(/margin:\s*0;/);
    });

    it.each([
        ['IssueTokenForm.module.css', issueCss, ':global([data-form-stack]) > .actions,\n.advancedOptions > .actions', 'margin-top'],
        ['IssueTokenForm.module.css', issueCss, ':global([data-form-stack]) > .warnings,\n.advancedOptions > .warnings', 'margin-bottom'],
        ['TokenWizard.module.css', wizardCss, ':global([data-form-stack]) > .actions', 'margin-top'],
        ['TokenWizard.module.css', wizardCss, ':global([data-form-stack]) > .warnings', 'margin-bottom'],
    ])('%s zeroes %s inside a form stack', (_name, css, selector, property) => {
        expect(rule(css, selector)).toMatch(new RegExp(`${property}:\\s*0;`));
    });
});
