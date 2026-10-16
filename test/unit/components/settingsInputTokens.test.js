// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The number boxes in Settings rows (Privacy, Safety, Fees, Undo send) share
// the field tokens with every other input: control border, radius, height,
// padding and type size. They once used the small radius and the small text
// size, so they sat beside a dropdown that looked different.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INPUT, INPUT_DISABLED } from '../../../packages/core/src/shared/components/settings/_settingsPrimitives.jsx';

describe('settings INPUT style', () => {
    it('is drawn from the shared control tokens', () => {
        expect(INPUT.border).toBe('1px solid var(--xc-control-border)');
        expect(INPUT.borderRadius).toBe('var(--xc-control-radius)');
        expect(INPUT.height).toBe('var(--xc-control-h-md)');
        expect(INPUT.fontSize).toBe('var(--xc-control-font-md)');
        expect(INPUT.padding).toBe('0 var(--xc-control-pad-x-md)');
    });
});

describe('settings INPUT_DISABLED style', () => {
    it('uses the shared disabled colours', () => {
        expect(INPUT_DISABLED.background).toBe('var(--xc-control-disabled-bg)');
        expect(INPUT_DISABLED.borderColor).toBe('var(--xc-control-disabled-border)');
        expect(INPUT_DISABLED.color).toBe('var(--xc-control-disabled-text)');
    });
});

describe('settings INPUT fill', () => {
    it('shares the dropdown surface so a number box matches the select above it in light and dark', () => {
        const tokens = readFileSync(resolve(process.cwd(), 'packages/core/src/ui/tokens.css'), 'utf8');
        const select = tokens.match(/:where\(select\) \{[^}]*background-color:\s*(var\(--xc-surface\))/);
        expect(select?.[1]).toBe('var(--xc-surface)');
        expect(INPUT.background).toBe(select[1]);
    });
});

describe('settings INPUT fill matches the shared Input', () => {
    const css = readFileSync('packages/core/src/ui/Input.module.css', 'utf8');
    const fillOf = (selector) => {
        const start = css.indexOf(`${selector} {`);
        const body = css.slice(start, css.indexOf('}', start));
        return body.match(/background:\s*([^;]+);/)?.[1];
    };

    it('paints enabled fields with the same fill token as Input, Select and Textarea', () => {
        expect(fillOf('.input')).toBe('var(--xc-surface)');
        expect(INPUT.background).toBe(fillOf('.input'));
    });

    it('paints disabled fields with the same disabled fill token as Input', () => {
        expect(css).toContain(`background: ${INPUT_DISABLED.background};`);
    });
});
