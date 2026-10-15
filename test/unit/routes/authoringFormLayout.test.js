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
import { describe, expect, it } from 'vitest';

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
