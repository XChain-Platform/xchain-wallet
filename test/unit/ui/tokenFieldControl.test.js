// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The token picker control is a button, so it composes the shared Button base
// for its press, focus and hidden states, then keeps the Input chrome: the
// field height scale, the control radius, start-aligned single-line text and
// the regular field weight. The behavior tests never read the stylesheet, so
// this reads it directly.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (path) => readFileSync(`packages/core/src/${path}`, 'utf8');
const rule = (source, selector) => {
    const start = source.indexOf(`${selector} {`);
    expect(start, `${selector} rule exists`).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf('}', start));
};

const source = css('shared/components/TokenField.module.css');

describe('token field control', () => {
    it('composes the shared Button base class', () => {
        expect(rule(source, '.control')).toMatch(
            /composes:\s*btn\s+from\s+["']\.\.\/\.\.\/ui\/Button\.module\.css["']/,
        );
    });

    it('keeps the field height scale and the control radius', () => {
        const control = rule(source, '.control');
        expect(control).toMatch(/(^|[\s;])height:\s*var\(--token-field-control-height\)/);
        expect(control).toContain('border-radius: var(--xc-control-radius)');
    });

    it('keeps start-aligned single-line text at the field weight over the Button base', () => {
        const control = rule(source, '.control');
        expect(control).toContain('justify-content: flex-start');
        expect(control).toContain('text-align: start');
        expect(control).toContain('white-space: nowrap');
        expect(control).toContain('font-weight: 400');
    });

    it('raises the lg control to the large field height', () => {
        expect(rule(source, '.lg')).toContain('--token-field-control-height: var(--xc-control-h-lg)');
    });
});
