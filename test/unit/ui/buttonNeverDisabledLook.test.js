// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G130 (operator 2026-11-16): a button never looks disabled. Every button
// keeps its colour; an action that cannot go ahead yet answers the tap with
// the G129 error summary instead of a greyed look. This guard reads the
// stylesheets that draw buttons and fails on any rule for a disabled
// (`:disabled` or `[aria-disabled]`) button that changes its colour,
// background, border colour, opacity, filter or cursor. A selector that only
// excludes the state (`:not(:disabled)`) is not a disabled rule.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');

const LOOK = /^(color|background|background-color|border-color|opacity|filter|cursor|-webkit-text-fill-color)$/;

/** Every innermost `selector { body }` rule of a stylesheet, comments removed. */
function rules(css) {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(flat))) out.push({ selector: m[1].trim(), body: m[2] });
    return out;
}

/** True when a selector targets the disabled state (not just excludes it). */
function targetsDisabled(selector) {
    const withoutNot = selector.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
    return /:disabled|\[aria-disabled/.test(withoutNot);
}

/** The look-changing declarations of a rule body. The switch's native input
 *  is invisible and stays at opacity 0 in every state, so that one is kept. */
function lookDeclarations(body) {
    return body.split(';')
        .map((decl) => decl.trim())
        .filter(Boolean)
        .map((decl) => {
            const at = decl.indexOf(':');
            return { prop: decl.slice(0, at).trim().toLowerCase(), value: decl.slice(at + 1).trim() };
        })
        .filter(({ prop, value }) => LOOK.test(prop) && !(prop === 'opacity' && /^0(\s*!important)?$/.test(value)));
}

function disabledLookRules(file, selectorFilter = () => true) {
    return rules(read(file))
        .filter(({ selector }) => targetsDisabled(selector) && selectorFilter(selector))
        .map(({ selector, body }) => ({ selector, decls: lookDeclarations(body) }))
        .filter(({ decls }) => decls.length > 0)
        .map(({ selector, decls }) => `${file}: ${selector} { ${decls.map((d) => `${d.prop}: ${d.value}`).join('; ')} }`);
}

describe('buttons never look disabled (G130)', () => {
    it('the Button stylesheet has no disabled colour, opacity, filter or cursor rule', () => {
        expect(disabledLookRules('packages/core/src/ui/Button.module.css')).toEqual([]);
    });

    it('the global token sheet does not grey or desaturate a disabled button', () => {
        // Only selectors that can match a button element or role: the field
        // rules (input, select, textarea) keep their read-only look.
        const buttonish = (selector) => /\bbutton\b|role=["']?button/.test(selector);
        expect(disabledLookRules('packages/core/src/ui/tokens.css', buttonish)).toEqual([]);
    });

    it.each([
        'packages/core/src/ui/FieldIconButton.module.css',
        'packages/core/src/ui/Chip.module.css',
        'packages/core/src/ui/SegmentedControl.module.css',
        'packages/core/src/ui/Switch.module.css',
        'packages/core/src/ui/PageHeader.module.css',
        'packages/core/src/shared/routes/MarketsList.module.css',
        'packages/core/src/shared/components/settings/ThisWalletSection.module.css',
    ])('%s keeps its button colours when disabled', (file) => {
        expect(disabledLookRules(file)).toEqual([]);
    });

    it('the guard itself catches a greyed rule and ignores an excluding one', () => {
        expect(targetsDisabled('.btn:disabled')).toBe(true);
        expect(targetsDisabled('.btn[aria-disabled="true"]')).toBe(true);
        expect(targetsDisabled('.btn:hover:not(:disabled)')).toBe(false);
        expect(lookDeclarations('opacity: 0.5; filter: saturate(0.35)').map((d) => d.prop)).toEqual(['opacity', 'filter']);
        expect(lookDeclarations('opacity: 0 !important')).toEqual([]);
    });
});
