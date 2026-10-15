// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Dark palette follow-ups (playwright.darkrtl.config.js): the app's own theme
// setting with the OS light, plus keyboard focus rings and hover states, which
// the plain walk never exercises. Findings go to results.jsonl and
// focus-hover.jsonl for a person to judge.

import { join, resolve } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
import {
    dismissIntroCarousel, expect, gotoSection, test, unlockedShell,
} from '../fixtures/wallet.js';
import { enterDemoWallet } from '../fixtures/responsive.js';
import { createSweep, measureInPage, measureRulings } from './sweep.js';

const OUT_ROOT = process.env.SWEEP_OUT
    || resolve(process.cwd(), '..', '..', 'tmp', 'darkrtl-sweep');

/** Runs in the page: the focused control's ring against what is behind it. */
function focusRing() {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
        const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    let bg = [0, 0, 0];
    for (let e = el.parentElement; e; e = e.parentElement) {
        const p = parse(getComputedStyle(e).backgroundColor);
        if (p.length >= 3 && (p[3] === undefined || p[3] > 0.9)) { bg = p.slice(0, 3); break; }
    }
    const a = lum(parse(cs.outlineColor).slice(0, 3));
    const b = lum(bg);
    const label = (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return {
        el: `${el.tagName.toLowerCase()} "${label}"`,
        style: cs.outlineStyle,
        width: parseFloat(cs.outlineWidth),
        ratio: Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2)),
        shadow: cs.boxShadow !== 'none',
    };
}

test('app dark setting sweep', async ({ page }, testInfo) => {
    test.skip(testInfo.project.metadata.mode !== 'darkset');
    test.setTimeout(60 * 60 * 1000);
    const sweep = createSweep(page, {
        venue: testInfo.project.name,
        outDir: join(OUT_ROOT, testInfo.project.name),
        contrast: true,
        onScreen: async (p) => ({ rulings: await p.evaluate(measureRulings) }),
    });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await gotoSection(page, 'Settings');
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-xc-theme', 'dark');
    await sweep.measure('darkset: appearance');
    await sweep.unlocked();
});

test('dark focus rings and hover contrast', async ({ page }, testInfo) => {
    test.skip(testInfo.project.metadata.mode !== 'dark');
    test.setTimeout(30 * 60 * 1000);
    const outDir = join(OUT_ROOT, testInfo.project.name);
    mkdirSync(outDir, { recursive: true });
    const log = (row) => appendFileSync(join(outDir, 'focus-hover.jsonl'), `${JSON.stringify(row)}\n`);
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    const fine = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
    for (const name of ['Home', 'History', 'Send', 'Receive', 'Scan', 'DEX', 'Marketplace', 'Dispensers', 'Contracts', 'Messaging', 'Contacts', 'Lists', 'Settings']) {
        if (name === 'Marketplace') {
            await page.keyboard.press('ControlOrMeta+k');
            const palette = page.getByRole('dialog', { name: 'Command palette' });
            await palette.getByRole('combobox').fill('Marketplace');
            await palette.getByRole('option').filter({ hasText: 'Marketplace' }).first().click();
        } else {
            await gotoSection(page, name);
        }
        await page.waitForTimeout(400);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: join(outDir, `screen-${name.toLowerCase()}.png`) }).catch(() => {});
        for (let i = 0; i < 14; i += 1) {
            await page.keyboard.press('Tab');
            const ring = await page.evaluate(focusRing);
            if (ring) log({ kind: 'focus', screen: name, ...ring });
        }
        if (!fine) continue;
        const targets = page.locator('main button:visible, main a[href]:visible, main [role=tab]:visible');
        const count = Math.min(await targets.count(), 30);
        for (let i = 0; i < count; i += 1) {
            try {
                await targets.nth(i).hover({ timeout: 2_000 });
                const res = await page.evaluate(measureInPage, { contrast: true });
                const target = await targets.nth(i).evaluate((e) => (e.getAttribute('aria-label') || e.innerText || e.tagName)
                    .trim().replace(/\s+/g, ' ').slice(0, 40));
                for (const row of res.lowContrast || []) log({ kind: 'hover', screen: name, target, ...row });
            } catch { /* a control that moves away on hover is skipped */ }
        }
    }
});
