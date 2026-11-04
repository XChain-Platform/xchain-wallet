// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A white button on a white page keeps a visible 1px outline. The shared Button
// base draws `1px solid transparent`, so a variant that paints a white fill has
// to set a border colour on the shared border token; otherwise the control
// loses its edge. This test reads the button module css and fails when a
// white-fill rule lacks a 1px non-white border.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BUTTON_CSS = 'packages/core/src/ui/Button.module.css';

// Light-palette tokens that resolve to white.
const WHITE_TOKENS = new Set(['--xc-bg', '--xc-surface', '--xc-surface-raised', '--xc-control-bg', '--xc-text-inverted', '--xc-on-accent']);
const EDGE_TOKENS = new Set(['--xc-border', '--xc-border-strong', '--xc-control-border', '--xc-control-border-hover']);

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function isWhite(value) {
    const v = value.trim().toLowerCase();
    if (v === 'white' || /^#f{3}$|^#f{6}$|^#f{8}$/.test(v)) return true;
    const token = v.match(/^var\(\s*(--[\w-]+)/);
    return Boolean(token && WHITE_TOKENS.has(token[1]));
}

function declarations(body) {
    const out = new Map();
    for (const part of body.split(';')) {
        const at = part.indexOf(':');
        if (at < 0) continue;
        out.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
    }
    return out;
}

/** A border colour that reads as an edge on white: a shared border token or a mid-tone literal. */
function isVisibleEdge(colour) {
    const c = (colour || '').trim().toLowerCase();
    if (!c || c === 'transparent' || c === 'none' || c === 'currentcolor') return false;
    if (isWhite(c)) return false;
    const token = c.match(/^var\(\s*(--[\w-]+)/);
    if (token) return EDGE_TOKENS.has(token[1]);
    return /^#[0-9a-f]{3,8}$/.test(c);
}

/** Selectors of white-fill rules whose border is not a 1px non-white edge. */
export function whiteFillWithoutEdge(css) {
    const faults = [];
    for (const rule of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim();
        if (selector.startsWith('@')) continue;
        const decl = declarations(rule[2]);
        const fill = decl.get('background') ?? decl.get('background-color');
        if (!fill || !isWhite(fill)) continue;
        const shorthand = decl.get('border');
        const colour = decl.get('border-color') ?? (shorthand ? shorthand.split(/\s+/).slice(2).join(' ') : '');
        const width = parseFloat(decl.get('border-width') ?? shorthand ?? '1');
        const edge = isVisibleEdge(colour) && !(width < 1);
        if (!edge) faults.push(selector);
    }
    return faults;
}

describe('white button outline', () => {
    it('every white-fill rule in the shared Button css carries a 1px non-white border', () => {
        expect(whiteFillWithoutEdge(readFileSync(BUTTON_CSS, 'utf8'))).toEqual([]);
    });

    it('the shared Button base keeps a 1px border so a variant only sets its colour', () => {
        const base = stripComments(readFileSync(BUTTON_CSS, 'utf8')).match(/\.btn\s*\{([^{}]*)\}/)?.[1] ?? '';
        expect(declarations(base).get('border')).toMatch(/^1px\s+solid\b/);
    });

    it('flags a white fill with a transparent or white border', () => {
        expect(whiteFillWithoutEdge('.a { background: #FFFFFF; }')).toEqual(['.a']);
        expect(whiteFillWithoutEdge('.b { background: var(--xc-surface); border-color: transparent; }')).toEqual(['.b']);
        expect(whiteFillWithoutEdge('.c { background: white; border: 1px solid #fff; }')).toEqual(['.c']);
        expect(whiteFillWithoutEdge('.d { background: #fff; border: 0 solid var(--xc-border); }')).toEqual(['.d']);
    });

    it('accepts a white fill that sets a shared border token', () => {
        expect(whiteFillWithoutEdge('.e { background: #FFFFFF; border-color: var(--xc-border-strong); }')).toEqual([]);
        expect(whiteFillWithoutEdge('.f { background: var(--xc-bg); border: 1px solid var(--xc-control-border); }')).toEqual([]);
        expect(whiteFillWithoutEdge('.g { background: transparent; border-color: transparent; }')).toEqual([]);
    });
});
