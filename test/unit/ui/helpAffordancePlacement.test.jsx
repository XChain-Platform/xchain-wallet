// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A form's help tip sits in the heading row it explains, never as a loose
// sibling on its own line. These source guards pin the three forms that used
// to render a lone "?" above their content.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name) => readFileSync(`packages/core/src/shared/routes/${name}`, 'utf8');

describe('help tip placement', () => {
    it('SignerSelectForm hands its intro to the icon dropdown help prop', () => {
        const source = read('SignerSelectForm.jsx');
        // A choice among a few named options is the themed icon dropdown (G44).
        expect(source).toMatch(/<IconSelect\s+label=\{t\('signerSelect\.title'\)\}[\s\S]*?help=\{t\('signerSelect\.intro'\)\}/);
        expect(source).not.toMatch(/<FormSection\b/);
        expect(source.match(/<InfoTip/g)).toBeNull();
    });

    it('ProjectRosterForm hands its explanations to field help props', () => {
        const source = read('ProjectRosterForm.jsx');
        // The token box is a text field, so its help rides the field's help
        // prop; the page draws no InfoTip of its own.
        expect(source.match(/<InfoTip/g)).toBeNull();
        expect(source).toMatch(/help=\{t\('projectRoster\.tokensHelp', \{ tick \}\)\}/);
        expect(source).toMatch(/addressHelp=\{`Only the current owner/);
        expect(source).toMatch(/help=\{t\('projectRoster\.listNameHelp', \{ tick \}\)\}/);
        // The lone memo is a MemoSection: no label row, so no tip (ruling).
        expect(source).toMatch(/<MemoSection\b/);
    });

    it('PairPartnerWallet keeps public-code guidance in the form notice', () => {
        const source = read('PairPartnerWallet.jsx');
        expect(source.match(/<InfoTip/g)).toBeNull();
        expect(source).toMatch(/<Notice key="public-code" tone="info" title="Public Codes"/);
        expect(source).toMatch(/<FormSection title="This wallet’s code">/);
    });
});
