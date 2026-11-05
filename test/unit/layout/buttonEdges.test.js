// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { measureButtonEdges } from '../../e2e/layout/button-outlines.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('measureButtonEdges', () => {
    it('writes the fill, backdrop, border, shadow and outline of each visible button', () => {
        document.body.innerHTML = '<div style="background:rgb(10, 20, 30)"><button aria-label="Send" class="_btn_x" style="background:rgb(255, 255, 255);border:0 none rgb(1, 2, 3)">Send</button></div>';
        const button = document.querySelector('button');
        button.getBoundingClientRect = () => ({ width: 40, height: 32, left: 0, top: 0, right: 40, bottom: 32 });
        const [record] = measureButtonEdges();
        expect(record).toMatchObject({
            tag: 'button', name: 'Send', shared: true, bg: 'rgb(255, 255, 255)', behind: 'rgb(10, 20, 30)', shadow: '',
        });
        expect(record.border).toContain('0px');
    });

    it('skips a button with no box', () => {
        document.body.innerHTML = '<button>Hidden</button>';
        expect(measureButtonEdges()).toEqual([]);
    });
});

describe('the balance hero swap button', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../../packages/core/src/shared/routes/TokenDetail.module.css'), 'utf8');
    const disabledRule = () => {
        const rule = css.match(/\.balanceHeroControls \.balanceHeroSwap\.balanceHeroSwap:disabled\s*\{([^}]*)\}/);
        expect(rule, 'a disabled swap rule outranks .btn:disabled:not(.link)').not.toBeNull();
        return rule[1];
    };

    it('keeps the translucent hero fill while disabled, never the near-white disabled tile', () => {
        const body = disabledRule();
        expect(body).toContain('background: color-mix(in srgb, var(--xc-on-accent) 15%, transparent)');
        expect(body).not.toMatch(/--xc-control-disabled-bg/);
    });

    it('draws a visible on-accent edge while disabled, so the dimmed control still reads as a button', () => {
        const border = disabledRule().match(/(?:^|;|\s)border\s*:\s*([^;]+);/);
        expect(border, 'the disabled swap sets a border').not.toBeNull();
        const value = border[1].trim();
        expect(value).not.toMatch(/^(none|0)\b/);
        expect(value).toMatch(/\bsolid\b/);
        expect(value).toContain('var(--xc-on-accent)');
    });

    it('keeps the 28px hero control size', () => {
        const base = css.match(/\.balanceHeroSwap,\s*\.balanceHeroEye\s*\{([^}]*)\}/);
        expect(base).not.toBeNull();
        expect(base[1]).toMatch(/width:\s*28px/);
        expect(base[1]).toMatch(/height:\s*28px/);
        expect(base[1]).toMatch(/box-sizing:\s*border-box/);
    });
});
