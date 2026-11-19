// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The shared page header centres its title on the full header width, whatever
// the buttons on either side (one Back on the left, two actions on the right
// is the Staking case), and a long title ends in an ellipsis before it meets
// a button. The CSS-level pins read the real stylesheet; the layout checks
// load that same stylesheet in headless Chromium, because the grid maths is
// not computed in jsdom.

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/ui/PageHeader.module.css', 'utf8');

function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

describe('PageHeader title centring (CSS)', () => {
    it('gives the two side lanes equal flexible tracks around the title', () => {
        const header = rule('.header');
        const cols = header.match(/grid-template-columns:\s*([^;]+);/)?.[1] || '';
        const tracks = cols.match(/minmax\((?:[^()]|\([^()]*\))*\)/g) || [];
        expect(tracks).toHaveLength(3);
        // Both side tracks are 1fr, so they split the space left by the title equally.
        expect(tracks[0]).toMatch(/1fr\)$/);
        expect(tracks[2]).toMatch(/1fr\)$/);
        // The title track shrinks to nothing before it can overlap a side lane.
        expect(tracks[1]).toMatch(/^minmax\(0,\s*auto\)$/);
        // The trailing lane never shrinks below its buttons.
        expect(tracks[2]).toMatch(/max-content/);
    });

    it('keeps the empty lanes at the side width and the title to one ellipsis line', () => {
        expect(rule('.spacer')).toMatch(/min-width:\s*var\(--xc-page-header-side\)/);
        expect(rule('.trailing')).toMatch(/min-width:\s*var\(--xc-page-header-side\)/);
        const title = rule('.title');
        expect(title).toMatch(/text-overflow:\s*ellipsis/);
        expect(title).toMatch(/white-space:\s*nowrap/);
        expect(rule('.titleGroup')).toMatch(/min-width:\s*0/);
    });
});

// Scan: no screen builds its own title bar. A page title is the shared
// PageHeader's h1, so the centring above reaches every page.
const sources = import.meta.glob(
    ['../../../packages/core/src/shared/**/*.jsx', '../../../packages/core/src/ui/*.jsx'],
    { query: '?raw', import: 'default', eager: true },
);

describe('PageHeader is the only page title bar', () => {
    it('renders a visible h1 nowhere else but the shared header and full-page exceptions', () => {
        const allowed = ['ui/PageHeader.jsx', 'RouteErrorBoundary.jsx', 'routes/Locked.jsx', 'routes/Onboarding.jsx', 'routes/VaultUnavailable.jsx'];
        const offenders = Object.entries(sources)
            .filter(([file, src]) => /<h1\b(?![^>]*sr-only)/.test(src) && !allowed.some((a) => file.endsWith(a)))
            .map(([file]) => file);
        expect(offenders).toEqual([]);
    });
});

let browser = null;
let page = null;

beforeAll(async () => {
    try {
        const { chromium } = await import('playwright');
        browser = await chromium.launch();
        page = await browser.newPage();
    } catch {
        browser = null;
    }
}, 60000);

afterAll(async () => {
    if (browser) await browser.close();
});

// Builds the header exactly as PageHeader.jsx lays it out, with the real CSS.
async function measure({ width, title, right, left = true }) {
    const buttons = Array.from({ length: right }, () => '<button style="width:44px;height:44px"></button>').join('');
    await page.setViewportSize({ width, height: 200 });
    await page.setContent(`<!doctype html><html><head><style>
        body { margin: 0; --xc-control-h-sm: 32px; --xc-space-2: 8px; --xc-space-1: 4px; font: 20px sans-serif; }
        ${css}
    </style></head><body>
        <div class="header" id="h">
            ${left ? '<button class="back" style="width:32px;height:32px"></button>' : '<span class="spacer"></span>'}
            <span class="titleGroup"><h1 class="title" id="t">${title}</h1></span>
            <span class="trailing">${buttons}</span>
        </div>
    </body></html>`);
    return page.evaluate(() => {
        const h = document.getElementById('h').getBoundingClientRect();
        const t = document.getElementById('t').getBoundingClientRect();
        const back = (document.querySelector('.back') || document.querySelector('.spacer')).getBoundingClientRect();
        const first = document.querySelector('.trailing button')?.getBoundingClientRect();
        const tg = document.querySelector('.titleGroup').getBoundingClientRect();
        const heading = document.getElementById('t');
        return {
            headerCentre: h.left + h.width / 2,
            groupCentre: tg.left + tg.width / 2,
            titleCentre: t.left + t.width / 2,
            titleLeft: t.left,
            titleRight: t.right,
            backRight: back.right,
            firstTrailingLeft: first ? first.left : null,
            truncated: heading.scrollWidth > heading.clientWidth,
        };
    });
}

describe('PageHeader title centring (layout)', () => {
    for (const width of [360, 412, 800]) {
        it(`centres a short title at ${width}px with one left and two right buttons`, async (ctx) => {
            if (!browser) return ctx.skip();
            const m = await measure({ width, title: 'Staking', right: 2 });
            expect(Math.abs(m.groupCentre - m.headerCentre)).toBeLessThanOrEqual(0.5);
            expect(Math.abs(m.titleCentre - m.headerCentre)).toBeLessThanOrEqual(0.5);
        });
    }

    it('centres a title with no left button and two right buttons', async (ctx) => {
        if (!browser) return ctx.skip();
        for (const width of [360, 412, 800]) {
            const m = await measure({ width, title: 'Messaging', right: 2, left: false });
            expect(Math.abs(m.titleCentre - m.headerCentre)).toBeLessThanOrEqual(0.5);
        }
    });

    it('centres a title with no trailing buttons and one trailing button', async (ctx) => {
        if (!browser) return ctx.skip();
        for (const right of [0, 1, 3]) {
            const m = await measure({ width: 390, title: 'Staking', right });
            expect(Math.abs(m.titleCentre - m.headerCentre)).toBeLessThanOrEqual(0.5);
        }
    });

    it('truncates a long title with an ellipsis before it meets either side', async (ctx) => {
        if (!browser) return ctx.skip();
        const m = await measure({
            width: 360,
            title: 'A very long page title that cannot fit between the buttons',
            right: 2,
        });
        expect(m.truncated).toBe(true);
        expect(m.titleLeft).toBeGreaterThanOrEqual(m.backRight - 0.5);
        expect(m.titleRight).toBeLessThanOrEqual(m.firstTrailingLeft + 0.5);
    });
});
