// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Dark palette and pseudo-RTL sweeps (playwright.darkrtl.config.js). Findings
// are written to results.jsonl for a person to judge; the walk fails only when
// it cannot complete.

import { join, resolve } from 'node:path';
import { appendFileSync } from 'node:fs';
import {
    dismissIntroCarousel, expect, gotoSection, nav, test, unlockedShell,
} from '../fixtures/wallet.js';
import { enterDemoWallet } from '../fixtures/responsive.js';
import { createSweep, measureRulings } from './sweep.js';

const OUT_ROOT = process.env.SWEEP_OUT
    || resolve(process.cwd(), '..', '..', 'tmp', 'darkrtl-sweep');

/** Runs in the page: dark-mode findings the contrast pass does not cover. */
function darkExtras() {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
        const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const bgOf = (el) => {
        for (let e = el; e; e = e.parentElement) {
            const p = parse(getComputedStyle(e).backgroundColor);
            if (p.length >= 3 && (p[3] === undefined || p[3] > 0.9)) return p.slice(0, 3);
        }
        return [0, 0, 0];
    };
    const desc = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} "${(el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`;
    const out = { weakFieldBorders: [], backlessMedia: [], invisibleCards: [] };
    for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')) {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        // The field or the wrapper that frames it carries the border.
        let frame = el; let best = 0;
        for (let i = 0; i < 3 && frame; i += 1, frame = frame.parentElement) {
            const cs = getComputedStyle(frame);
            if (parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none') {
                best = Math.max(best, ratio(parse(cs.borderTopColor), bgOf(frame.parentElement || frame)));
            }
        }
        if (best < 3 && out.weakFieldBorders.length < 10) out.weakFieldBorders.push({ el: desc(el), ratio: Number(best.toFixed(2)) });
    }
    for (const el of document.querySelectorAll('canvas, img')) {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) continue;
        const bg = bgOf(el);
        out.backlessMedia.push({ el: desc(el), bgLum: Number(lum(bg).toFixed(2)), w: Math.round(r.width), alt: el.getAttribute('alt') || '' });
    }
    for (const el of document.querySelectorAll('[class*="card" i], [class*="Card"]')) {
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.height < 24) continue;
        const cs = getComputedStyle(el);
        const bw = parseFloat(cs.borderTopWidth);
        const parentBg = bgOf(el.parentElement);
        const own = parse(cs.backgroundColor);
        const diff = own.length >= 3 && (own[3] === undefined || own[3] > 0.5) ? ratio(own.slice(0, 3), parentBg) : 1;
        const edge = bw >= 1 && cs.borderTopStyle !== 'none' ? ratio(parse(cs.borderTopColor), parentBg) : 1;
        if (Math.max(diff, edge) < 1.15 && cs.boxShadow === 'none' && out.invisibleCards.length < 10) {
            out.invisibleCards.push({ el: desc(el), fill: Number(diff.toFixed(2)), edge: Number(edge.toFixed(2)) });
        }
    }
    return out;
}

/** Runs in the page: right-to-left findings. */
function rtlExtras() {
    const desc = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} "${(el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 36)}"`;
    const out = { rtlAddressNotLtr: [], physicalAlign: [], glyphArrows: [], wrongDir: document.documentElement.dir };
    const ADDR = /\b(?:(?:bc1|tb1|ltc1|bcrt1)[a-z0-9]{20,}|0x[0-9a-fA-F]{16,}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|[A-Za-z0-9]{28,})\b/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || /^(SCRIPT|STYLE)$/.test(el.tagName)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const t = n.textContent;
        if (ADDR.test(t) && out.rtlAddressNotLtr.length < 10) {
            const bidi = cs.unicodeBidi;
            const ok = (cs.direction === 'ltr' && el.closest('[dir]')?.dir !== 'rtl') || /isolate|embed|override|plaintext/.test(bidi);
            if (!ok) out.rtlAddressNotLtr.push({ el: desc(el), direction: cs.direction, bidi });
        }
        if (/[→←›‹»«▶◀➜➔↗↙]/.test(t) && out.glyphArrows.length < 10) out.glyphArrows.push({ el: desc(el), text: t.trim().slice(0, 30) });
    }
    for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if ((cs.textAlign === 'left' || cs.textAlign === 'right') && (el.textContent || '').trim().length > 3 && out.physicalAlign.length < 10) {
            out.physicalAlign.push({ el: desc(el), align: cs.textAlign });
        }
    }
    return out;
}

async function perScreen(page, label, mode) {
    const extra = { rulings: await page.evaluate(measureRulings) };
    if (mode === 'dark') extra.dark = await page.evaluate(darkExtras);
    else extra.rtl = await page.evaluate(rtlExtras);
    return extra;
}

function pseudo(name) {
    const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^\\u200F?⟦${e}⟧`);
}

async function enablePseudoRtl(page) {
    await gotoSection(page, 'Settings');
    await page.getByRole('main').getByRole('button', { name: /^Developer mode/ }).click();
    const dev = page.getByRole('switch', { name: 'Turn on developer mode', exact: true });
    if (!(await dev.isChecked())) { await dev.click(); await expect(dev).toBeChecked(); }
    await page.getByRole('button', { name: 'Back to settings' }).click();
    await page.getByLabel('Language', { exact: true }).selectOption('pseudo-rtl');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

test('dark sweep', async ({ page }, testInfo) => {
    test.skip(testInfo.project.metadata.mode !== 'dark');
    test.setTimeout(60 * 60 * 1000);
    const sweep = createSweep(page, {
        venue: testInfo.project.name,
        outDir: join(OUT_ROOT, testInfo.project.name),
        contrast: true,
        onScreen: (p, label) => perScreen(p, label, 'dark'),
    });
    await sweep.onboarding();
    await sweep.unlocked();
});

test('rtl sweep', async ({ page }, testInfo) => {
    test.skip(testInfo.project.metadata.mode !== 'rtl');
    test.setTimeout(60 * 60 * 1000);
    const outDir = join(OUT_ROOT, testInfo.project.name);
    const sweep = createSweep(page, {
        venue: testInfo.project.name,
        outDir,
        onScreen: (p, label) => perScreen(p, label, 'rtl'),
    });
    const skip = (label, err) => appendFileSync(join(outDir, 'results.jsonl'),
        `${JSON.stringify({ label, skipped: String(err?.message || err).slice(0, 140) })}\n`);
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await enablePseudoRtl(page);
    await sweep.measure('rtl: settings root');

    const names = ['Home', 'History', 'Send', 'Receive', 'Scan', 'DEX', 'Dispensers', 'Contracts',
        'Messaging', 'Contacts', 'Lists', 'Payments due', 'Settings'];
    const goto = async (name) => {
        const item = nav(page).getByRole('button', { name: pseudo(name) }).first();
        if (await item.isVisible().catch(() => false)) { await item.click(); return; }
        await nav(page).getByRole('button', { name: pseudo('More') }).first().click();
        const sheet = page.getByRole('dialog', { name: pseudo('More') });
        await sheet.getByRole('button', { name: pseudo(name) }).first().click();
    };
    for (const name of names) {
        try {
            await goto(name);
            await sweep.measure(`rtl route: ${name}`);
        } catch (err) { skip(`rtl route: ${name}`, err); }
    }
    // Marketplace and the rest of the palette.
    try {
        await page.keyboard.press('ControlOrMeta+k');
        const palette = page.getByRole('dialog', { name: pseudo('Command palette') });
        await palette.waitFor({ state: 'visible', timeout: 10_000 });
        await sweep.measure('rtl palette: open');
        const titles = await palette.getByRole('option').evaluateAll((els) => els
            .map((e) => (e.querySelector('[class*="title"], [class*="label"]')?.textContent || e.textContent || '').trim()));
        await page.keyboard.press('Escape');
        for (const title of [...new Set(titles.filter((t) => t && !/^\d/.test(t)))].slice(0, 140)) {
            try {
                await page.keyboard.press('ControlOrMeta+k');
                await palette.waitFor({ state: 'visible', timeout: 5_000 });
                await palette.getByRole('combobox').fill(title);
                await palette.getByRole('option').filter({ hasText: title }).first().click({ timeout: 5_000 });
                await sweep.measure(`rtl palette: ${title}`);
            } catch (err) { skip(`rtl palette: ${title}`, err); await page.keyboard.press('Escape').catch(() => {}); }
        }
    } catch (err) { skip('rtl palette', err); }
    // Settings sections by row index.
    try {
        await goto('Settings');
        const count = await page.getByRole('main').locator('button:visible').count();
        for (let i = 0; i < Math.min(count, 30); i += 1) {
            try {
                await goto('Settings');
                const back = page.locator('button:has(svg[data-xc-directional]):visible').first();
                if (await back.isVisible().catch(() => false) && await page.getByRole('searchbox').count() === 0) await back.click();
                const row = page.getByRole('main').locator('button:visible').nth(i);
                const label = ((await row.innerText().catch(() => '')) || `row ${i}`).split('\n')[0].slice(0, 40);
                if (/lock|remove|delete|reset|wipe|erase|backup|reveal|recovery|export/i.test(label)) continue;
                await row.click({ timeout: 4_000 });
                await sweep.measure(`rtl settings: ${label}`);
            } catch (err) { skip(`rtl settings row ${i}`, err); }
        }
    } catch (err) { skip('rtl settings', err); }
    // Header popovers.
    for (const re of [/Settings/, /Scan and addresses/, /XChain platform sites/, /Open menu/]) {
        try {
            const b = page.getByRole('button', { name: re }).first();
            if (!(await b.isVisible().catch(() => false))) continue;
            await b.click();
            await sweep.measure(`rtl header: ${re}`);
            await page.keyboard.press('Escape');
        } catch (err) { skip(`rtl header ${re}`, err); }
    }
});
