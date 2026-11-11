// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The main forward action (Button variant success) stays fully green while
// disabled, so the shared desaturation on disabled controls must not reach it,
// while every other disabled control keeps that desaturation.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');

function declarations(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[1] : null;
}

describe('disabled success button', () => {
    const button = read('packages/core/src/ui/Button.module.css');
    const tokens = read('packages/core/src/ui/tokens.css');

    it('opts out of the disabled saturation filter', () => {
        const rule = declarations(button, '.success:disabled');
        expect(rule).not.toBeNull();
        expect(rule).toMatch(/filter:\s*none/);
    });

    it('keeps the green fill and does not recolor the success button when disabled', () => {
        expect(declarations(button, '.success')).toMatch(/background:\s*var\(--xc-success-fill\)/);
        expect(button).toMatch(/\.btn:disabled:not\(\.link\):not\(\.success\)/);
    });

    it('leaves the shared saturation filter on other disabled controls', () => {
        const rule = declarations(tokens, ':where(input, select, textarea, button):disabled');
        expect(rule).toMatch(/filter:\s*saturate\(var\(--xc-disabled-saturation\)\)/);
        expect(declarations(button, '.btn:disabled')).not.toMatch(/filter:\s*none/);
    });
});
