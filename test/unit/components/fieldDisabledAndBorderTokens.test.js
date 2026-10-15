// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every field draws its resting border from the control-border token and its
// disabled state from the shared disabled colours, as a Button does. The
// token picker, the icon select, the native select rule and the text input
// each kept their own border token or faded themselves with opacity.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (path) => readFileSync(`packages/core/src/${path}`, 'utf8');
const rule = (source, selector) => {
    const start = source.indexOf(`${selector} {`);
    expect(start, `${selector} rule exists`).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf('}', start));
};

describe('field tokens', () => {
    it('draws every field border from the control-border token', () => {
        expect(rule(css('shared/components/TokenField.module.css'), '.control')).toContain('border: 1px solid var(--xc-control-border)');
        expect(rule(css('ui/IconSelect.module.css'), '.trigger')).toContain('border: 1px solid var(--xc-control-border)');
    });

    it('draws every disabled field from the shared disabled colours', () => {
        const disabled = [
            rule(css('ui/Input.module.css'), '.input:disabled'),
            rule(css('shared/components/TokenField.module.css'), '.control:disabled'),
            rule(css('ui/IconSelect.module.css'), '.trigger:disabled'),
            rule(css('ui/tokens.css'), 'select:disabled'),
        ];
        for (const block of disabled) {
            expect(block).toContain('var(--xc-control-disabled-bg)');
            expect(block).toContain('var(--xc-control-disabled-border)');
            expect(block).toContain('var(--xc-control-disabled-text)');
            expect(block).not.toMatch(/opacity:\s*0\.55/);
        }
    });

    it('keeps the transparent native input of a Switch and Checkbox transparent when disabled', () => {
        // tokens.css sets a disabled control's opacity with !important, which
        // painted a gray native box over a disabled switch's track.
        expect(rule(css('ui/Switch.module.css'), '.input')).toContain('opacity: 0 !important');
        expect(rule(css('ui/Checkbox.module.css'), '.input')).toContain('opacity: 0 !important');
    });
});
