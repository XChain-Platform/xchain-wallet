// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BUTTON_CSS = 'packages/core/src/ui/Button.module.css';
const INPUT_CSS = 'packages/core/src/ui/Input.module.css';
const TOKEN_CSS = 'packages/core/src/ui/tokens.css';
const TOKEN_CHIPS_CSS = 'packages/core/src/shared/routes/MyTokens.module.css';

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    expect(match, selector).not.toBeNull();
    return match[1];
}

describe('small controls keep compact paint and large touch targets', () => {
    const buttonCss = readFileSync(BUTTON_CSS, 'utf8');
    const inputCss = readFileSync(INPUT_CSS, 'utf8');
    const tokenCss = readFileSync(TOKEN_CSS, 'utf8');
    const chipsCss = readFileSync(TOKEN_CHIPS_CSS, 'utf8');

    it('paints small buttons at 28px with an extra-small label', () => {
        const small = rule(buttonCss, '.sm');
        expect(small).toMatch(/--xc-button-height:\s*calc\(var\(--xc-space-6\) \+ var\(--xc-space-1\)\)/);
        expect(small).toMatch(/--xc-button-font-size:\s*var\(--xc-text-xs\)/);
        expect(small).not.toMatch(/--xc-control-h-sm|--xc-control-font-sm/);
    });

    it('keeps small fields on the shared small-height token', () => {
        const small = rule(inputCss, '.sm');
        expect(small).toMatch(/--xc-control-height:\s*var\(--xc-control-h-sm\)/);
    });

    it('keeps transparent 44px hit layers for buttons and fields', () => {
        expect(buttonCss).toMatch(/\.sm::before\s*\{[^}]*width:\s*max\(100%,\s*var\(--xc-control-hit-min/s);
        expect(buttonCss).toMatch(/\.sm::before\s*\{[^}]*height:\s*max\(100%,\s*var\(--xc-control-hit-min/s);
        expect(inputCss).toMatch(/\.controlHitArea::before\s*\{[^}]*height:\s*max\(100%,\s*var\(--xc-control-hit-min/s);
        expect(tokenCss).toMatch(/--xc-control-hit-min:\s*44px/);
    });

    it('keeps the My tokens segmented choice compact with the same hit layer', () => {
        const group = rule(chipsCss, '.chipGroup');
        expect(group).toMatch(/height:\s*calc\(var\(--xc-space-6\) \+ var\(--xc-space-1\)\)/);
        expect(group).toMatch(/overflow:\s*visible/);
        expect(rule(chipsCss, '.chip')).toMatch(/font-size:\s*var\(--xc-text-xs\)/);
        expect(chipsCss).toMatch(/\.chip::before\s*\{[^}]*height:\s*max\(100%,\s*var\(--xc-control-hit-min\)\)/s);
    });
});
