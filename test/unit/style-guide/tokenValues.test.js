// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    THEME_TOKENS,
    declaredToken,
    parseThemeTokens,
    resolveToken,
    tokenIn,
} from '../../../packages/web/src/style-guide/tokenValues.js';

const CSS = `
:root {
    --xc-a: #111; /* comment */
    --xc-b: var(--xc-a);
    --xc-c: 0 0 0 1px var(--xc-b), var(--xc-missing, red);
}
@media (prefers-color-scheme: dark) {
    :root { --xc-a: #999; }
}
:root[data-xc-theme="dark"] {
    --xc-a: #222;
}
`;

describe('parseThemeTokens', () => {
    it('reads the top-level light block and overlays the explicit dark block', () => {
        const { light, dark } = parseThemeTokens(CSS);
        expect(light.get('--xc-a')).toBe('#111');
        expect(dark.get('--xc-a')).toBe('#222');
        expect(dark.get('--xc-b')).toBe('var(--xc-a)');
    });

    it('resolves nested var references per theme and keeps fallbacks', () => {
        const { light, dark } = parseThemeTokens(CSS);
        expect(resolveToken(light, '--xc-b')).toBe('#111');
        expect(resolveToken(dark, '--xc-c')).toBe('0 0 0 1px #222, red');
    });

    it('does not loop on a reference cycle', () => {
        const values = new Map([['--xc-x', 'var(--xc-y)'], ['--xc-y', 'var(--xc-x)']]);
        expect(() => resolveToken(values, '--xc-x')).not.toThrow();
    });
});

describe('real tokens.css', () => {
    it('exposes the card tokens in both themes', () => {
        expect(declaredToken('--xc-card-pad')).toBeTruthy();
        expect(tokenIn('light', '--xc-bg')).toMatch(/^#/);
        expect(tokenIn('dark', '--xc-bg')).not.toBe(tokenIn('light', '--xc-bg'));
        expect(THEME_TOKENS.dark.size).toBeGreaterThanOrEqual(THEME_TOKENS.light.size);
    });
});
