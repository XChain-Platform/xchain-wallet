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

describe('the balance hero menu trigger', () => {
    const heroCss = readFileSync(resolve(import.meta.dirname, '../../../packages/core/src/shared/components/TotalBalanceHero.module.css'), 'utf8');
    const tokenCss = readFileSync(resolve(import.meta.dirname, '../../../packages/core/src/shared/routes/TokenDetail.module.css'), 'utf8');
    const triggerRule = () => {
        const rule = heroCss.match(/\.eye\s*\{([^}]*)\}/);
        expect(rule, 'the shared Balance actions trigger has a base rule').not.toBeNull();
        return rule[1];
    };

    it('keeps the translucent hero fill on the accent card, never the near-white disabled tile', () => {
        const body = triggerRule();
        expect(body).toContain('background: color-mix(in srgb, var(--xc-on-accent) 15%, transparent)');
        expect(body).toContain('color: var(--xc-on-accent)');
        expect(body).not.toMatch(/--xc-control-disabled-bg/);
    });

    it('sizes the trigger from the small control token', () => {
        const body = triggerRule();
        expect(body).toMatch(/width:\s*var\(--xc-control-h-sm\)/);
        expect(body).toMatch(/height:\s*var\(--xc-control-h-sm\)/);
    });

    it('leaves the token hero with no loose swap or eye controls of its own', () => {
        expect(tokenCss).not.toMatch(/\.balanceHero(?:Swap|Eye|Controls)\b/);
        expect(tokenCss).toMatch(/\.balanceHeroMenu\s*\{[^}]*grid-area:\s*controls/);
    });
});
