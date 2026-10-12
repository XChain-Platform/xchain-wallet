// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Layout sweep: walk every screen the wallet can reach and measure it for the
// faults a user sees but no functional test catches - content off the edge of
// the screen, text cut off by a clipping parent, a page that scrolls sideways,
// panels that scroll when they should fit, and content below the fold that
// nothing lets you reach.
//
// It runs the same walk in every venue (Chromium at Android sizes, WebKit at
// iPhone and iPad sizes, the Electron desktop app at several window sizes),
// writes one JSON line and one screenshot per screen, and never fails a test
// on a finding: findings are for a person to judge, because some scrolling is
// meant to be there.

import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    completeRecoveryPhraseChallenge, dismissIntroCarousel, gotoSection, nav, openSettings,
    readRecoveryPhrase, unlockedShell,
} from '../fixtures/wallet.js';

/** Names never clicked: they lock, delete, reset, or leave the wallet. */
const DESTRUCTIVE = /lock|remove|delete|reset|wipe|erase|sign ?out|log ?out|forget|revoke|uninstall|export|backup|reveal|show (seed|recovery)|recovery phrase|private key|clear (all|data)|factory/i;

/**
 * Runs inside the page. Returns what is wrong with the current screen.
 * Plain function body: no closures over Node values.
 */
export function measureInPage() {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const se = document.scrollingElement || document.documentElement;
    const desc = (el) => {
        let s = el.tagName.toLowerCase();
        const cls = [...el.classList].slice(0, 2).join('.');
        if (cls) s += `.${cls}`;
        const label = el.getAttribute('aria-label')
            || (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
        if (label) s += ` "${label}"`;
        return s;
    };
    const scrollable = (v) => v === 'auto' || v === 'scroll' || v === 'overlay';
    const res = {
        vw,
        vh,
        title: (document.querySelector('h1, [class*="title"]')?.textContent || '').trim().slice(0, 60),
        pageScrollX: Math.max(0, se.scrollWidth - se.clientWidth),
        pageScrollY: Math.max(0, se.scrollHeight - se.clientHeight),
        offscreen: [],
        clipped: [],
        unreachable: [],
        xScrollers: [],
        yScrollers: [],
    };
    const seen = new Set();
    const push = (list, item) => {
        const key = `${list}|${item.el}`;
        if (seen.has(key) || res[list].length >= 15) return;
        seen.add(key);
        res[list].push(item);
    };
    for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (scrollable(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
            push('xScrollers', { el: desc(el), by: el.scrollWidth - el.clientWidth, w: Math.round(r.width) });
        }
        if (scrollable(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
            push('yScrollers', { el: desc(el), by: el.scrollHeight - el.clientHeight, h: Math.round(r.height) });
        }
        // The part of the element that can actually be seen after every
        // clipping ancestor, and whether any ancestor scrolls vertically.
        let L = r.left; let R = r.right; let T = r.top; let B = r.bottom;
        let clipX = null; let inYScroller = false; let fixed = cs.position === 'fixed';
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
            const acs = getComputedStyle(a);
            const ar = a.getBoundingClientRect();
            if (acs.overflowX !== 'visible') {
                if (L < ar.left || R > ar.right) clipX = clipX || a;
                L = Math.max(L, ar.left); R = Math.min(R, ar.right);
            }
            if (acs.overflowY !== 'visible') {
                if (scrollable(acs.overflowY)) inYScroller = true;
                T = Math.max(T, ar.top); B = Math.min(B, ar.bottom);
            }
            if (acs.position === 'fixed') { fixed = true; break; }
        }
        if (R - L < 1 || B - T < 1) continue; // scrolled out of its own scroller: fine
        const leaf = el.children.length === 0
            || ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG', 'svg', 'CANVAS', 'VIDEO'].includes(el.tagName);
        if (!leaf) continue;
        if (R > vw + 1 || L < -1) {
            push('offscreen', { el: desc(el), left: Math.round(L), right: Math.round(R) });
        } else if (clipX && (r.right > R + 2 || r.left < L - 2)) {
            const ccs = getComputedStyle(clipX);
            if (ccs.overflowX === 'hidden' || ccs.overflowX === 'clip') {
                push('clipped', { el: desc(el), by: desc(clipX), cut: Math.round(Math.max(r.right - R, L - r.left)) });
            }
        }
        if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.children.length === 0
            && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis') {
            push('clipped', { el: desc(el), by: 'itself', cut: el.scrollWidth - el.clientWidth });
        }
        if (!fixed && !inYScroller && res.pageScrollY === 0 && B > vh + 1) {
            push('unreachable', { el: desc(el), top: Math.round(T), bottom: Math.round(B) });
        }
    }
    return res;
}

/** A sweep bound to one page, one venue and one output directory. */
export function createSweep(page, { venue, outDir, restart = () => page.goto('/') }) {
    mkdirSync(outDir, { recursive: true });
    const linesPath = join(outDir, 'results.jsonl');
    writeFileSync(linesPath, '');
    let n = 0;

    async function measure(label) {
        await page.waitForTimeout(450);
        n += 1;
        const slug = `${String(n).padStart(3, '0')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
        let result;
        try {
            result = await page.evaluate(measureInPage);
        } catch (err) {
            result = { error: String(err?.message || err) };
        }
        try {
            await page.screenshot({ path: join(outDir, `${slug}.png`) });
        } catch { /* a screenshot failure is not a finding */ }
        appendFileSync(linesPath, `${JSON.stringify({ venue, n, label, shot: `${slug}.png`, ...result })}\n`);
        return result;
    }

    /** Close anything open and land on Home. */
    async function home() {
        for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape').catch(() => {});
        try {
            if (await nav(page).count() > 0) {
                await gotoSection(page, 'Home');
                return;
            }
        } catch { /* fall through */ }
        for (let i = 0; i < 6; i += 1) {
            const back = page.getByRole('button', { name: /^Back/ }).first();
            if (await back.count() === 0 || !(await back.isVisible().catch(() => false))) break;
            await back.click().catch(() => {});
            await page.waitForTimeout(200);
        }
    }

    /** The visible, enabled buttons of the current screen's content area. */
    function rowButtons() {
        return page.locator('main button:visible:not([disabled])');
    }

    /**
     * Open each row of a list screen in turn, measure it, and come back.
     * Rows are addressed by position and re-found after every return, so a
     * row whose accessible name differs from its text is still visited.
     * `reopen` brings the list screen back.
     */
    async function crawlRows(prefix, reopen) {
        await reopen();
        const labels = await rowButtons().evaluateAll((els) => els.map((e) => (
            (e.innerText || e.getAttribute('aria-label') || '').trim().split('\n')[0].trim()
        )));
        let visited = 0;
        for (let i = 0; i < labels.length; i += 1) {
            const label = labels[i];
            if (!label || /^Back/.test(label) || DESTRUCTIVE.test(label)) continue;
            try {
                await reopen();
                const row = rowButtons().nth(i);
                const now = (await row.innerText({ timeout: 3_000 })).trim().split('\n')[0].trim();
                if (now !== label) continue; // the list changed under us
                await row.click({ timeout: 5_000 });
                await measure(`${prefix}: ${label}`);
                visited += 1;
            } catch (err) {
                appendFileSync(linesPath, `${JSON.stringify({ venue, label: `${prefix}: ${label}`, skipped: String(err?.message || err).slice(0, 120) })}\n`);
            }
        }
        if (visited === 0) {
            appendFileSync(linesPath, `${JSON.stringify({ venue, label: prefix, skipped: `no rows visited out of ${labels.length} found` })}\n`);
        }
        await home();
    }

    /**
     * The onboarding walk. `demo` stops short of persisting a wallet and
     * enters demo mode instead, for venues where creating a real vault
     * would touch the OS keychain (the desktop app).
     */
    async function onboarding({ demo = false } = {}) {
        await restart();
        await page.getByRole('button', { name: 'Skip' }).or(page.getByRole('button', { name: 'Create new wallet' }))
            .first().waitFor({ state: 'visible', timeout: 60_000 });
        await measure('onboarding: intro carousel');
        await dismissIntroCarousel(page);
        await measure('onboarding: welcome');
        for (const name of ['Import wallet', 'From FreeWallet', 'Pair a watcher or signer']) {
            const btn = page.getByRole('button', { name });
            if (await btn.count() === 0) continue;
            await btn.click();
            await measure(`onboarding: ${name}`);
            await restart();
            await dismissIntroCarousel(page);
        }
        // The create walk, measured at each stage.
        await page.getByRole('button', { name: 'Create new wallet' }).click();
        await measure('create: password');
        await page.getByLabel('Password', { exact: true }).fill('layoutsweep1234');
        await page.getByLabel(/^Confirm( password)?$/).fill('layoutsweep1234');
        await page.getByRole('button', { name: 'Next' }).click();
        await page.getByLabel(/written down|saved my recovery phrase/i).waitFor({ timeout: 60_000 });
        await measure('create: recovery phrase');
        const words = await readRecoveryPhrase(page);
        await page.getByLabel(/written down|saved my recovery phrase/i).check();
        await page.getByRole('button', { name: 'Verify recovery phrase' }).click();
        await measure('create: verify phrase');
        await completeRecoveryPhraseChallenge(page, words);
        if (demo) {
            await restart();
            await dismissIntroCarousel(page);
            await page.getByRole('button', { name: 'Try in demo mode' }).click();
            await unlockedShell(page).waitFor({ state: 'visible', timeout: 120_000 });
            return;
        }
        await page.getByRole('button', { name: 'Create wallet' }).click();
        const notice = page.getByRole('heading', { name: 'Automatic Donation System', exact: true });
        await notice.or(unlockedShell(page)).first().waitFor({ state: 'visible', timeout: 240_000 });
        if (await notice.isVisible()) {
            await measure('create: donation notice');
            await page.getByRole('button', { name: 'Continue', exact: true }).click();
        }
        await unlockedShell(page).waitFor({ state: 'visible', timeout: 240_000 });
    }

    async function unlocked() {
        await measure('home: coins');
        for (const tab of ['Tokens', 'NFTs', 'DeFi', 'Activity']) {
            const t = page.getByRole('tab', { name: tab }).or(page.getByRole('button', { name: tab, exact: true })).first();
            if (await t.count() === 0) continue;
            await t.click().catch(() => {});
            await measure(`home: ${tab}`);
        }
        await home();

        // Header popovers.
        for (const name of ['Settings', 'Scan and addresses', 'XChain platform sites']) {
            const b = page.getByRole('button', { name, exact: true }).first();
            if (await b.count() === 0 || !(await b.isVisible())) continue;
            await b.click();
            await measure(`header: ${name} popover`);
            await page.keyboard.press('Escape');
            if (await b.getAttribute('aria-expanded') === 'true') await b.click().catch(() => {});
        }

        // Every destination the command palette offers. The desktop app has
        // no header button for it; there the keyboard shortcut opens it.
        const paletteButton = page.getByRole('button', { name: 'Open command palette' }).first();
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        const openPalette = async () => {
            if (await paletteButton.count() > 0 && await paletteButton.isVisible().catch(() => false)) {
                await paletteButton.click();
            } else {
                await page.keyboard.press('ControlOrMeta+k');
            }
            await palette.waitFor({ state: 'visible', timeout: 10_000 });
        };
        let destinations = [];
        if (await openPalette().then(() => true, () => false)) {
            await measure('palette: open');
            destinations = await palette.getByRole('option').evaluateAll((els) => els
                .map((e) => (e.querySelector('[class*="title"], [class*="label"]')?.textContent || e.textContent || '').trim()));
            destinations = [...new Set(destinations.filter((x) => x && !/^\d/.test(x)))];
            await page.keyboard.press('Escape');
        }
        for (const dest of destinations) {
            if (DESTRUCTIVE.test(dest)) continue;
            try {
                await openPalette();
                await palette.getByRole('combobox').fill(dest);
                const option = palette.getByRole('option').filter({ hasText: dest }).first();
                await option.click({ timeout: 5_000 });
                await measure(`palette: ${dest}`);
            } catch (err) {
                appendFileSync(linesPath, `${JSON.stringify({ venue, label: `palette: ${dest}`, skipped: String(err?.message || err).slice(0, 120) })}\n`);
            }
            await home();
        }

        // The hamburger menu screen and each of its rows.
        const menu = page.getByRole('button', { name: 'Open menu' }).first();
        if (await menu.count() > 0 && await menu.isVisible()) {
            await home();
            await menu.click();
            await measure('menu: list');
            await crawlRows('menu', async () => {
                if (await page.getByText('Menu', { exact: true }).first().isVisible().catch(() => false)) return;
                await home();
                await menu.click();
                await page.waitForTimeout(300);
            });
        }

        // Settings and every section in it.
        await home();
        await openSettings(page);
        await measure('settings: list');
        await crawlRows('settings', async () => {
            const back = page.getByRole('button', { name: 'Back to settings' });
            if (await back.count() > 0 && await back.isVisible().catch(() => false)) {
                await back.click();
                await page.waitForTimeout(250);
                return;
            }
            if (await page.getByRole('searchbox', { name: 'Search settings' }).isVisible().catch(() => false)) return;
            await home();
            await openSettings(page);
        });

        // The bottom navigation's More sheet, where it exists.
        const more = nav(page).getByRole('button', { name: 'More', exact: true });
        if (await more.count() > 0) {
            await more.click();
            await measure('nav: More sheet');
            await page.keyboard.press('Escape');
        }
    }

    return { measure, home, onboarding, unlocked };
}
