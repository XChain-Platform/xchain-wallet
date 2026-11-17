// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// G113: Speed and Fees is one shared component on every form, and its one
// custom fee editor is the Network fee line. No route or component draws its
// own fee slider, fee-rate input or custom fee box: the selector is placed
// only by the Form Standard's FeeSection, and FeeSelector itself holds the
// only fee inputs (the exact-fee editor, plus the rate editor a chain with no
// estimate needs, in that same place).

import { describe, expect, it } from 'vitest';

import { cachedSourceFiles } from '../../helpers/sourceScan.js';

const sources = cachedSourceFiles('packages', '*/src/**/*.{js,jsx}');

// The selector itself, and the style guide that documents it.
const SELECTOR = 'core/src/ui/FeeSelector.jsx';
const STYLE_GUIDE = /^web\/src\/style-guide\//;
// The only place a form may place the selector.
const FEE_SECTION = 'core/src/shared/components/formStandard/FeeSection.jsx';
// The confirm-side fee card: it takes a selector slot, never draws one.
const FEES_CARD = 'core/src/shared/components/FeesCard.jsx';
// The Settings default-fee preference is not a transaction form: it stores a
// default rate for future transactions, with its own labelled rate field.
const SETTINGS_FEES = 'core/src/shared/components/settings/FeesSection.jsx';

// Reviewed exception: the generic stop slider (the Oracle usage fee percent
// and kin). It slides a percent between stops and is not a network fee.
const STOP_SLIDER = 'core/src/shared/components/StopSlider.jsx';

const scanned =sources.filter(({ relativePath }) => (
    relativePath !== SELECTOR && !STYLE_GUIDE.test(relativePath)
));

describe('one Speed and Fees editor (G113)', () => {
    it('places FeeSelector only inside the Form Standard FeeSection', () => {
        const placements = scanned
            .filter(({ source }) => /<FeeSelector\b/.test(source))
            .map(({ relativePath }) => relativePath);
        expect(placements).toEqual([FEE_SECTION]);
    });

    it('hands no route a fee selector slot to fill', () => {
        const slots = scanned
            .filter(({ relativePath }) => relativePath !== FEES_CARD)
            .filter(({ source }) => /\bfeeSelector=\{/.test(source))
            .map(({ relativePath }) => relativePath);
        expect(slots).toEqual([]);
    });

    it('lets no route or component draw its own fee slider or fee input', () => {
        const offenders = [];
        for (const { relativePath, source } of scanned) {
            // The locale tables define the copy; they draw nothing.
            if (relativePath === SETTINGS_FEES || /\/i18n\//.test(relativePath)) continue;
            // The selector's own copy keys name its two editors.
            if (/ui\.feeSelector\.(customFeeRate|networkFeeAmount)/.test(source)) {
                offenders.push(`${relativePath}: fee editor label`);
            }
            // A range input is a fee slider unless it is the duration slider.
            if (/type="range"/.test(source) && !/DurationSlider/.test(relativePath) && relativePath !== STOP_SLIDER) {
                offenders.push(`${relativePath}: range input`);
            }
            // An input named for a fee rate, fee amount or custom fee.
            for (const match of source.matchAll(/<(?:input|Input|TextField|AmountInput)\b[\s\S]*?\/?>/g)) {
                if (/(?:aria-label|label|name|placeholder)=\{?["'`][^"'`]*(?:fee rate|sat\/vB|network fee|custom fee)/i.test(match[0])) {
                    offenders.push(`${relativePath}: ${match[0].slice(0, 80)}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('keeps exactly the two fee text inputs inside FeeSelector, with no row for a second box', () => {
        const selector = sources.find(({ relativePath }) => relativePath === SELECTOR).source;
        expect(selector.match(/type="text"/g) || []).toHaveLength(2);
        // The rate input renders only for a chain with no estimate.
        expect(selector).toMatch(/\{rateOnly \? \(/);
        expect(selector).not.toMatch(/feeLineCustom/);
    });
});
