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

/**
 * Runs in the page: the chart range toggle against the chart panel its tabs
 * control. Returns the panel and toggle centres and each range button's box.
 */
function measureRanges(list) {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const panel = document.getElementById(tabs[0]?.getAttribute('aria-controls') || '');
    const centre = (r) => r.left + r.width / 2;
    const own = list.getBoundingClientRect();
    const boxes = tabs.map((tab) => tab.getBoundingClientRect());
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.right));
    return {
        panel: panel ? centre(panel.getBoundingClientRect()) : null,
        list: centre(own),
        listWidth: own.width,
        buttons: (left + right) / 2,
        span: right - left,
        outlines: tabs.map((tab) => parseFloat(getComputedStyle(tab).borderTopWidth) || 0),
        heights: boxes.map((b) => Number(b.height.toFixed(2))),
        tops: boxes.map((b) => Math.round(b.top)),
    };
}

async function expectCompactCentredRanges(page, where) {
    const list = page.getByRole('main').getByRole('tablist', { name: /Chart range/ }).first();
    await expect(list, `${where}: the chart range toggle shows`).toBeVisible({ timeout: 30_000 });
    const m = await list.evaluate(measureRanges);
    expect(m.panel, `${where}: the range tabs control a chart panel`).not.toBeNull();
    expect(Math.abs(m.list - m.panel), `${where}: the range row is centred under the chart`).toBeLessThanOrEqual(1);
    expect(Math.abs(m.buttons - m.panel), `${where}: the range buttons are centred under the chart`).toBeLessThanOrEqual(1);
    expect(new Set(m.tops).size, `${where}: the range buttons sit on one line`).toBe(1);
    expect(Math.abs(m.listWidth - m.span), `${where}: the range row hugs its options`).toBeLessThanOrEqual(1);
    for (const w of m.outlines) expect(w, `${where}: a range option draws no outline`).toBe(0);
    for (const h of m.heights) expect(h, `${where}: a range button is compact`).toBeLessThanOrEqual(28);
}

// The price chart's range control is a minimal small toggle centred along the
// bottom of the chart, on Home and on token detail, in both directions.
test('chart range toggle is centred and compact', async ({ page }, testInfo) => {
    const { mode } = testInfo.project.metadata;
    test.skip(mode !== 'dark' && mode !== 'rtl');
    test.setTimeout(10 * 60 * 1000);
    await page.emulateMedia({ colorScheme: 'dark' });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    const home = mode === 'rtl' ? pseudo('Home') : /^Home$/;
    if (mode === 'rtl') {
        await enablePseudoRtl(page);
        await nav(page).getByRole('button', { name: home }).first().click();
    }
    await expectCompactCentredRanges(page, `${mode} home`);

    const balances = page.getByRole('main').getByRole('list', { name: /Balances/ }).first();
    await balances.getByRole('listitem').first().getByRole('button').first().click();
    await expect(balances, `${mode}: the balance row opens token detail`).toBeHidden();
    await expectCompactCentredRanges(page, `${mode} token detail`);
});

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

    const routes = [
        ['Home', 'home'], ['History', 'history'], ['Send', 'send'], ['Receive', 'receive'],
        ['Scan', 'scan'], ['My tokens', 'my-tokens'], ['Addresses', 'addresses'], ['DEX', 'markets'],
        ['Marketplace', 'market-activity'], ['Dispensers', 'dispensers-list'],
        ['Cross-chain', 'cross-chain-templates'], ['Payments due', 'obligations'],
        ['Contracts', 'contracts-list'], ['Staking', 'staking-dashboard'],
        ['Multisig', 'multisig-create'], ['Lists', 'lists'], ['All actions', 'actions'],
        ['Messaging', 'messaging'], ['Contacts', 'contacts'], ['Alerts', 'alerts'],
        ['Settings', 'settings'],
    ];
    const goto = async (name, id) => {
        const item = nav(page).getByRole('button', { name: pseudo(name) }).first();
        if (await item.isVisible().catch(() => false)) { await item.click(); return; }
        await page.getByRole('button', { name: pseudo('Open menu') }).first().click();
        const menu = page.getByRole('dialog', { name: pseudo('Wallet menu') });
        await menu.locator(`[data-wallet-menu-row="${id}"]`).click();
    };
    for (const [name, id] of routes) {
        try {
            await goto(name, id);
            await sweep.measure(`rtl route: ${name}`);
        } catch (err) { skip(`rtl route: ${name}`, err); }
    }
    // The catalogue itself is a layout surface.
    try {
        await page.keyboard.press('ControlOrMeta+k');
        const menu = page.getByRole('dialog', { name: pseudo('Wallet menu') });
        await menu.waitFor({ state: 'visible', timeout: 10_000 });
        await sweep.measure('rtl menu: open');
        await page.keyboard.press('Escape');
    } catch (err) { skip('rtl menu', err); }
    // Settings sections by row index.
    try {
        await goto('Settings', 'settings');
        const count = await page.getByRole('main').locator('button:visible').count();
        for (let i = 0; i < Math.min(count, 30); i += 1) {
            try {
                await goto('Settings', 'settings');
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
    // Header wallet menu.
    for (const re of [/Open menu/]) {
        try {
            const b = page.getByRole('button', { name: re }).first();
            if (!(await b.isVisible().catch(() => false))) continue;
            await b.click();
            await sweep.measure(`rtl header: ${re}`);
            await page.keyboard.press('Escape');
        } catch (err) { skip(`rtl header ${re}`, err); }
    }
});
