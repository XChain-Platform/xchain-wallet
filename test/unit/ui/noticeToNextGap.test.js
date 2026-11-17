// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A notice sits 8px (--xc-space-2, G80) above the next element on the boot
// and onboarding notice screens: Wallet Unavailable (VaultUnavailable and the
// Loading error state) and the Automatic Donations notice (AdsNotice).
//
// jsdom has no layout, so this pins the CSS that makes the gap. Measured in
// headless Chromium before the fix: 16px (17 on the vault list, 25 on the wide
// donation card) from FormPage's page gap being the form's 16px row gap, and
// 16px on the Loading error from its 8px gap plus the notice row's own 8px
// block margin.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
}

describe('notice to next element gap is 8px', () => {
    // 2026-11-16: the notice is the form's first item (inside the wide card),
    // and the next element sits 8px under it instead of the 16px row gap.
    it('FormPage puts its notices 8px above the next element, not on the 16px row gap', () => {
        const css = read('packages/core/src/ui/FormPage.module.css');
        expect(ruleBody(css, '.status')).toMatch(/gap:\s*var\(--xc-space-2\)\s*;/);
        expect(css).toMatch(/\.status:not\(:empty\) \+ \*,[^{]*\{\s*margin-block-start:\s*calc\(var\(--xc-space-2\) - var\(--xc-form-gap, var\(--xc-space-4\)\)\);/);
    });

    it('the Loading error panel gaps 8px and its notice row adds no margin', () => {
        const css = read('packages/core/src/shared/routes/Loading.module.css');
        expect(ruleBody(css, '.errorPanel')).toMatch(/gap:\s*var\(--xc-space-2\)\s*;/);
        expect(ruleBody(css, '.errorPanel > [data-variant]')).toMatch(/margin:\s*0\s*;/);
    });

    it('VaultUnavailable keeps the page gap and AdsNotice uses an 8px form gap', () => {
        const vault = read('packages/core/src/shared/routes/VaultUnavailable.module.css');
        expect(ruleBody(vault, '.wrap')).toMatch(/gap:\s*var\(--xc-space-2\)\s*;/);
        expect(ruleBody(vault, '.wrap')).not.toMatch(/margin-(block|top)/);
        const ads = read('packages/core/src/shared/components/AdsNotice.jsx');
        const adsCss = read('packages/core/src/shared/components/AdsNotice.module.css');
        expect(ads).toMatch(/className=\{styles\.form\}/);
        expect(ads).toMatch(/<FormPage[\s\S]*<Notice[\s\S]*<\/FormPage>/);
        expect(ruleBody(adsCss, '.form')).toMatch(/--xc-form-gap:\s*var\(--xc-space-2\)\s*;/);
        expect(adsCss).not.toMatch(/margin-(block|top)/);
    });
});
