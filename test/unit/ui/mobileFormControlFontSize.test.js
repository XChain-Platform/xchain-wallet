// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseRules } from '../../../packages/core/scripts/forced-colors-audit.js';

const css = readFileSync(join(process.cwd(), 'packages/core/src/ui/tokens.css'), 'utf8');
const selector = [
    "input:not([type='checkbox']):not([type='radio']):not([type='range'])",
    'select',
    'textarea',
].join(',\n    ');

function hasMobileFontFloor(source) {
    const rules = parseRules(source).filter((rule) => rule.selector === selector);
    return rules.length === 1
        && /font-size:\s*1rem\s*!important\s*;/.test(rules[0].body)
        && rules[0].at.length === 1
        && rules[0].at[0] === '@media (max-width: 599px)';
}

describe('mobile form control font size', () => {
    it('sets the 1rem floor only below 600px', () => {
        expect(hasMobileFontFloor(css)).toBe(true);
    });

    it('rejects desktop scope, missing controls, and overridable floors', () => {
        expect(hasMobileFontFloor(css.replace('max-width: 599px', 'min-width: 600px'))).toBe(false);
        expect(hasMobileFontFloor(css.replace('    select,\n', ''))).toBe(false);
        expect(hasMobileFontFloor(css.replace('1rem !important', '1rem'))).toBe(false);
    });
});
