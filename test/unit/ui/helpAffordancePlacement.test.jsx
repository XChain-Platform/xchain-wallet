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
    it('SignerSelectForm hands its intro to the choice group help prop', () => {
        const source = read('SignerSelectForm.jsx');
        expect(source).toMatch(/<RadioGroup\s+legend=\{t\('signerSelect\.title'\)\}[\s\S]*?help=\{t\('signerSelect\.intro'\)\}/);
        expect(source).not.toMatch(/<FormSection\b/);
        expect(source.match(/<InfoTip/g)).toBeNull();
    });

    it('ProjectRosterForm hands its explanations to field help props', () => {
        const source = read('ProjectRosterForm.jsx');
        // The token rows are not one input, so their label row carries the
        // one tip, the same InfoTip a field label draws.
        expect(source.match(/<InfoTip/g)).toHaveLength(1);
        expect(source).toMatch(/label=\{t\('projectRoster\.tokensHelp', \{ tick \}\)\}/);
        expect(source).toMatch(/addressHelp=\{`Only the current owner/);
        expect(source).toMatch(/help=\{t\('projectRoster\.listNameHelp', \{ tick \}\)\}/);
        expect(source).toMatch(/help="An optional public note stored on the chain/);
    });

    it('PairPartnerWallet keeps its tip in the section heading and shows the role help as text', () => {
        const source = read('PairPartnerWallet.jsx');
        expect(source.match(/<InfoTip/g)).toHaveLength(1);
        expect(source).toMatch(/title="This wallet’s code"\s+trailing=\{<InfoTip/);
    });
});
