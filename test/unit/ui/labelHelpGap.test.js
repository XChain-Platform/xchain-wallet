// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G116: a help icon sits about one text space after its label, from one
// shared gap token. Every label-plus-help wrapper either puts the token in its
// own gap or sets gap 0 and lets the tip's start margin (the token) space it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = (p) => readFileSync(`packages/core/src/${p}`, 'utf8');
const rule = (css, selector) => {
    const found = `\n${css}`.lastIndexOf(`\n${selector} {`);
    expect(found, `${selector} rule exists`).toBeGreaterThan(-1);
    const start = Math.max(0, found - 1);
    return css.slice(start, css.indexOf('}', start));
};

// [file, selector, how the wrapper takes the token]
const TOKEN_GAP = [
    ['ui/Switch.module.css', '.labelLine'],
    ['ui/Checkbox.module.css', '.labelLine'],
    ['ui/ChainPicker.module.css', '.labelRow'],
];
// The Fees card's protocol fee line lost its help tip under G121 (help sits
// only beside editable fields), and its .labelWithHelp rule with it.
const TIP_MARGIN_GAP = [
    ['shared/routes/MultisigCreate.module.css', '.fieldLabelRow'],
    ['shared/routes/PollDetail.module.css', '.ballotLabelRow'],
    ['shared/routes/Send.module.css', '.assetPickerLabelRow'],
    ['shared/routes/SignMessageForm.module.css', '.signatureLabelRow'],
];

describe('label-to-help gap token (G116)', () => {
    it('defines one token worth half the old 8px plus 4px spacing', () => {
        expect(src('ui/tokens.css')).toMatch(/--xc-label-help-gap:\s*2px;/);
    });

    it('InfoTip takes its start margin from the token', () => {
        expect(rule(src('ui/InfoTip.module.css'), '.wrap')).toMatch(
            /margin-inline-start:\s*var\(--xc-label-help-gap\)/,
        );
    });

    it.each(TOKEN_GAP)('%s %s takes its gap from the token', (file, selector) => {
        const body = rule(src(file), selector);
        expect(body).toMatch(/gap:\s*var\(--xc-label-help-gap\)/);
    });

    it.each(TIP_MARGIN_GAP)('%s %s adds no gap beside the tip margin', (file, selector) => {
        const body = rule(src(file), selector);
        expect(body).toMatch(/(?:column-)?gap:\s*0[;\s]/);
        expect(body).not.toMatch(/(?<!row-)gap:\s*var\(--xc-space/);
    });

    it('Input, Textarea and IconSelect tips trim the row gap down to the token', () => {
        expect(rule(src('ui/Input.module.css'), '.labelHelp')).toMatch(
            /margin-inline-start:\s*calc\(var\(--xc-label-help-gap\) - var\(--xc-space-2\)\)/,
        );
    });

    it('RadioGroup legend help and settings rows use the token or the tip margin', () => {
        expect(rule(src('ui/RadioGroup.module.css'), '.legendHelp')).toMatch(/var\(--xc-label-help-gap\)/);
        expect(src('shared/components/settings/_settingsPrimitives.jsx')).toMatch(
            /ROW_LABEL_LINE = \{[\s\S]*?gap: 0,/,
        );
    });

    it('no stylesheet gives an InfoTip a hand-set pixel start margin', () => {
        expect(src('ui/InfoTip.module.css')).not.toMatch(/margin-inline-start:\s*\d+px/);
    });
});
