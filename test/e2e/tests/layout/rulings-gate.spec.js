// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The UI rulings gate. Walks every screen the layout sweep reaches, at a
// phone and a desktop size, and counts each screen's findings against the
// operator's UI rulings (see ../../layout/rulings-gate.js for the keys):
// the measureRulings keys, sideways page scroll, unreachable content, a
// header or navigation that scrolls away, and lists short of the content
// width. A count above what rulings.allowlist.json holds for that screen
// fails. The allowlist is the open UI debt: it only shrinks
// (test/unit/layout/rulingsAllowlist.test.js), and a fix that clears a
// screen takes its entry off.
//
// RULINGS_SEED=<dir> writes each venue's counts to <dir>/<venue>.json and
// skips the assertion; ../../layout/seed-rulings-allowlist.mjs folds runs
// into the allowlist.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../../fixtures/wallet.js';
import {
    createSweep, layoutSweepFindings, measureInPage, measureRulings,
} from '../../layout/sweep.js';
import { allowlistOverruns, allowlistSlack, countRulings } from '../../layout/rulings-gate.js';

const allowlist = JSON.parse(readFileSync(new URL('./rulings.allowlist.json', import.meta.url), 'utf8'));
const SEED_DIR = process.env.RULINGS_SEED || '';

// The card and hero tokens the meter reads, as tokens.css defines them.
const TOKENS = `<style>:root { --xc-card-border: 1px solid rgb(129, 139, 155); --xc-card-radius: 8px;
    --xc-hero-border: rgb(157, 184, 211); }</style>`;

test('a hero surface and a Quick Give/Get card pass the card check and an off-token card fails', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const box = 'width: 300px; height: 80px; margin: 8px; border-radius: 8px;';
    await page.setContent(`${TOKENS}<main id="xc-main">
        <div id="card" style="${box} border: 1px solid rgb(129, 139, 155)">A card</div>
        <div id="hero" style="${box} border: 1px solid rgb(157, 184, 211)">Wallet value</div>
        <section class="_card_gg_131" style="${box} border: 1px solid rgb(129, 139, 155); border-radius: 12px">
            <div class="_cardMid_gg_162">You give</div></section></main>`);
    expect((await page.evaluate(measureRulings)).offTokenCards).toBeUndefined();
    await page.setContent(`${TOKENS}<main id="xc-main">
        <div style="${box} border: 1px solid rgb(157, 184, 211); border-radius: 12px">Hero border, off radius</div>
        <section class="_card_gg_131" style="${box} border: 1px solid rgb(129, 139, 155); border-radius: 12px">
            <div>No amount row</div></section></main>`);
    expect((await page.evaluate(measureRulings)).offTokenCards).toHaveLength(2);
});

test('the Quick Give/Get amount passes the field border check and any other borderless field fails', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const field = 'border: 0; background: transparent; width: 200px; height: 48px;';
    await page.setContent(`<main id="xc-main"><input class="_bigAmount_gg_169" aria-label="Give amount" style="${field}"></main>`);
    expect((await page.evaluate(measureRulings)).borderlessFields).toBeUndefined();
    await page.setContent(`<main id="xc-main"><input class="_amount_gg_169" aria-label="Give amount" style="${field}"></main>`);
    expect((await page.evaluate(measureRulings)).borderlessFields).toHaveLength(1);
});

/**
 * A list-and-detail page (G128, PanelSplit): a list column whose fixed
 * header sits above its own scrolling body, beside a scrolling detail panel.
 */
const splitPage = (listBody, detailBody, listHeader = '') => `<main id="xc-main" style="height: 700px; overflow-y: auto; padding: 0 8px; box-sizing: border-box">
    <div style="display: flex; gap: 8px">
        <div class="_listPanel_ps_113" style="width: 380px; height: 600px; display: flex; flex-direction: column">
            <div>${listHeader}</div>
            <div style="flex: 1 1 auto; min-height: 0; overflow-y: auto">${listBody}</div>
        </div>
        <div style="flex: 1 1 0; height: 600px; overflow-y: auto">${detailBody}</div>
    </div></main>`;
const listCard = (width) => `<ul role="list" style="width: ${width}; box-sizing: border-box; margin: 0; padding: 0; border: 1px solid #888; list-style: none">
    <li><button>Bitcoin</button></li><li><button>Dogecoin</button></li></ul>`;

test('a list that fills its panel passes the content edge check and a short one fails', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const contentEdge = async () => layoutSweepFindings([{ label: 'split', ...(await page.evaluate(measureInPage, {})) }])
        .filter((f) => f.key === 'contentEdge').map((f) => f.detail);
    await page.setContent(splitPage(listCard('100%'), listCard('100%'), listCard('100%')));
    expect(await contentEdge()).toEqual([]);
    await page.setContent(splitPage(listCard('200px'), listCard('100%')));
    expect((await contentEdge()).join('\n')).toContain('short of the 380px content width');
    await page.setContent(splitPage(listCard('100%'), listCard('100%'), listCard('200px')));
    expect((await contentEdge()).join('\n')).toContain('short of the 380px content width');
});

test('a notice first in its panel at the panel width passes and a narrow one fails', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const notice = (width) => `<div role="status" style="width: ${width}">5 contact changes are only on this device</div>`;
    await page.setContent(splitPage(`${notice('100%')}${listCard('100%')}`, listCard('100%')));
    expect((await page.evaluate(measureRulings)).noticePlacement).toBeUndefined();
    await page.setContent(splitPage(`${notice('200px')}${listCard('100%')}`, listCard('100%')));
    expect((await page.evaluate(measureRulings)).noticePlacement).toEqual([
        expect.objectContaining({ contentAbove: false, width: 200, content: 380 }),
    ]);
});

const VENUES = [
    { name: 'phone-360', viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true },
    { name: 'desktop-1280', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
];

for (const venue of VENUES) {
    test.describe(`UI rulings at ${venue.name}`, () => {
        test.use({ viewport: venue.viewport, isMobile: venue.isMobile, hasTouch: venue.hasTouch });

        test(`every screen holds to the UI rulings at ${venue.name}`, async ({ page }, testInfo) => {
            test.setTimeout(40 * 60 * 1000);
            const screens = [];
            const sweep = createSweep(page, {
                venue: venue.name,
                outDir: testInfo.outputPath('sweep'),
                rulings: true,
                screenshots: false,
                onResult: (result) => screens.push(result),
            });
            // Demo mode: the walk reaches every unlocked screen without a
            // vault, so no key derivation runs.
            await sweep.onboarding({ demo: true });
            await sweep.unlocked();

            expect(screens.length, 'harness coverage: the walk measured screens').toBeGreaterThan(20);
            const unmeasured = screens.filter((s) => s.error || s.rulingsError).map((s) => `${s.label}: ${s.error || s.rulingsError}`);
            expect(unmeasured, 'every screen was measured').toEqual([]);

            const counts = countRulings(venue.name, screens);
            if (SEED_DIR) {
                mkdirSync(SEED_DIR, { recursive: true });
                writeFileSync(join(SEED_DIR, `${venue.name}.json`), `${JSON.stringify(counts, null, 1)}\n`);
                return;
            }
            const slack = allowlistSlack(counts, allowlist, venue.name);
            if (slack.length) {
                testInfo.annotations.push({ type: 'allowlist can shrink', description: slack.join('\n') });
            }
            expect(allowlistOverruns(counts, allowlist), 'findings beyond rulings.allowlist.json').toEqual([]);
        });
    });
}
