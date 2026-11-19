// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { measureButtonEdges, measureButtonSizes } from '../../e2e/layout/button-outlines.js';

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

describe('measureButtonSizes', () => {
    it('reports shared sizes and distinguishes role-like button surfaces', () => {
        document.body.innerHTML = `
            <nav>
                <button data-bottom-tab="home" class="_btn_x _md_x">Home</button>
                <button class="_item_x">Settings</button>
            </nav>
            <button class="_row_x">Bitcoin</button>
            <div aria-hidden="true"><button class="_sliderTick_x">Fast</button></div>
            <button aria-label="About fees" aria-describedby="fee-tip">?</button>
            <span id="fee-tip" role="tooltip">Fee help</span>
            <button class="_marketCard_x">Market</button>
            <button class="_btn_x _primary_x _sm_x">Save</button>
        `;
        for (const button of document.querySelectorAll('button')) {
            button.getBoundingClientRect = () => ({ width: 80, height: 36, left: 0, top: 0, right: 80, bottom: 36 });
        }

        expect(measureButtonSizes().map(({ name, kind, shared, sizes }) => ({ name, kind, shared, sizes }))).toEqual([
            { name: 'Home', kind: 'tab', shared: true, sizes: ['md'] },
            { name: 'Settings', kind: 'navigation', shared: false, sizes: [] },
            { name: 'Bitcoin', kind: 'row', shared: false, sizes: [] },
            { name: 'Fast', kind: 'slider-tick', shared: false, sizes: [] },
            { name: 'About fees', kind: 'help', shared: false, sizes: [] },
            { name: 'Market', kind: 'card', shared: false, sizes: [] },
            { name: 'Save', kind: 'action', shared: true, sizes: ['sm'] },
        ]);
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

    it('uses the solid Hero 2 control tokens, never the disabled tile', () => {
        const body = triggerRule();
        expect(body).toContain('background: var(--xc-hero-chip-bg)');
        expect(body).toContain('border: 1px solid var(--xc-hero-border)');
        expect(body).toContain('color: var(--xc-hero-chip-text)');
        expect(body).not.toMatch(/--xc-control-disabled-bg/);
    });

    it('sizes the trigger from the small control token', () => {
        const body = triggerRule();
        expect(body).toMatch(/width:\s*var\(--xc-control-h-sm\)/);
        expect(body).toMatch(/height:\s*var\(--xc-control-h-sm\)/);
    });

    it('leaves the token hero with no loose swap or eye controls of its own', () => {
        expect(tokenCss).not.toMatch(/\.balanceHero(?:Swap|Eye|Controls)\b/);
        // The token hero draws its swap and eye with the shared balance card's own
        // classes, so TokenDetail's stylesheet carries no hero menu of its own.
        expect(tokenCss).not.toMatch(/\.balanceHeroMenu\b/);
        expect(heroCss).toMatch(/\.inlineActions\b/);
    });
});
