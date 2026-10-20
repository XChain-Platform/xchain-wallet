#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Visual comparison gate for layout batches.
//
// Layout fixes proven only by jsdom tests can still wrap a header onto two
// rows, scroll the desktop shell's header away or push a control off centre,
// because jsdom never lays anything out. This script boots the web app from
// two checkouts (a baseline and a candidate) side by side, enters demo mode in
// each, photographs the same screens at the same sizes, and writes a report
// sorted by how much each screen changed, so a person sees every visual change
// a batch makes before it lands.
//
//     node tools/visual-compare.mjs --baseline <tree> --candidate <tree> --out <dir>
//         [--port-base 5391]    baseline dev server port; the candidate uses port + 1 (alias --port)
//         [--sizes k51,phone412] only these sizes (names below)
//         [--screens home,settings] only these screens (keys below)
//         [--max-settings 40]   cap on Settings sub-pages visited
//         [--tolerance 24]      per-channel difference a pixel may carry and still match
//         [--keep-threshold .5] retain rows at or above this percent difference
//         [--keep-all]           retain every captured PNG
//
// Each tree must already have its dependencies installed. The dev servers run
// with the mock SDK (VITE_XCHAIN_REAL_SDK=0), the same as the layout sweep, and
// every request that leaves localhost is refused so live data cannot make two
// identical layouts differ. Output: <out>/index.html (the report), <out>/index.json
// (every screen, size and phase with its three PNG paths and the percent),
// <out>/shots/{baseline,candidate}/..., <out>/diff/...

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pngjs from 'pngjs';
import {
    optimizePngs, pruneReportRows, VISUAL_REPORT_GENERATOR,
} from './visual-report-files.mjs';

const { PNG } = pngjs;

// ---------------------------------------------------------------- arguments

export function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
        out[key] = next;
        i += 1;
    }
    return out;
}

const IS_MAIN = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const args = parseArgs(process.argv.slice(2));
if (IS_MAIN && (!args.baseline || !args.candidate || !args.out)) {
    console.error('usage: visual-compare.mjs --baseline <tree> --candidate <tree> --out <dir> [--port-base N] [--sizes a,b] [--screens a,b] [--keep-threshold N] [--keep-all]');
    process.exit(2);
}
const OUT = args.out ? resolve(args.out) : null;
const PORT = Number(args['port-base'] || args.port) || 5391;
const TOLERANCE = Number(args.tolerance) || 24;
const MAX_SETTINGS = Number(args['max-settings']) || 40;
const KEEP_ALL = args['keep-all'] === true;
const KEEP_THRESHOLD = args['keep-threshold'] === undefined
    ? 0.5
    : Number(args['keep-threshold'] === true ? Number.NaN : args['keep-threshold']);
if (IS_MAIN && (!Number.isFinite(KEEP_THRESHOLD) || KEEP_THRESHOLD < 0)) {
    console.error('--keep-threshold must be a non-negative number');
    process.exit(2);
}

// ---------------------------------------------------------------- sizes

// Touch sizes are phones (the LG K51 is the smallest device the wallet is
// tested on). The two extension surfaces only change layout through
// packages/extension/src/popup/popup.css, which the web build never loads,
// so the tree's own copy is injected with the attribute or class it keys on.
// The toolbar popup also boots the web app's `?variant=extension` frame,
// which is how the web build simulates the 360x600 popup. The desktop app
// marks nothing on <html> (its renderer differs only in MessagingProvider
// wiring), so the desktop sizes are the web layout at those widths.
export const SIZES = [
    { name: 'k51-360x800', width: 360, height: 800, touch: true },
    { name: 'phone-412x869', width: 412, height: 869, touch: true },
    { name: 'landscape-844x390', width: 844, height: 390, touch: true },
    { name: 'sidepanel-400x800', width: 400, height: 800, surface: 'sidepanel' },
    { name: 'popup-360x600', width: 360, height: 600, surface: 'popup', query: '?variant=extension' },
    { name: 'desktop-1280x800', width: 1280, height: 800 },
    { name: 'desktop-1460x920', width: 1460, height: 920 },
];

// Destinations reached through the command palette, which every width and
// the popup variant offer; the nav rail, bottom bar and More sheet do not.
export const SCREENS = [
    { key: 'home', title: 'Home' },
    { key: 'history', title: 'History' },
    { key: 'send', title: 'Send' },
    { key: 'receive', title: 'Receive' },
    { key: 'swap', title: 'Swap', heading: 'Swap tokens' },
    { key: 'create-token', title: 'Create a token', heading: 'Issue a token' },
    { key: 'markets', title: 'Open DEX', heading: 'Decentralized exchange' },
    { key: 'contacts', title: 'Contacts' },
    { key: 'addresses', title: 'Addresses' },
    { key: 'settings', title: 'Settings' },
];

export const pick = (list, csv) => {
    if (!csv || csv === true) return list;
    const wanted = String(csv).split(',').map((s) => s.trim()).filter(Boolean);
    return list.filter((x) => wanted.some((w) => (x.name || x.key).startsWith(w)));
};
const sizes = pick(SIZES, args.sizes);
export const screenSelected = (key, csv) => {
    const screenKeys = csv && csv !== true ? String(csv).split(',').map((s) => s.trim()) : null;
    return !screenKeys || screenKeys.some((wanted) => key.startsWith(wanted));
};
const wantScreen = (key) => screenSelected(key, args.screens);

/** Names never clicked in Settings: they lock, delete, reset, or leave the wallet. */
const DESTRUCTIVE = /lock|remove|delete|reset|wipe|erase|sign ?out|log ?out|forget|revoke|uninstall|export|backup|reveal|show (seed|recovery)|recovery phrase|private key|clear (all|data)|factory/i;

// ---------------------------------------------------------------- dev servers

const servers = [];

function stopServers() {
    for (const s of servers) {
        if (s.stopped) continue;
        s.stopped = true;
        // The server was spawned as its own process group, so this reaches
        // vite and anything it started, and nothing else.
        try { process.kill(-s.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
}
if (IS_MAIN) {
    process.on('exit', stopServers);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServers(); process.exit(130); });
}

function viteBin(tree) {
    for (const p of [join(tree, 'packages/web/node_modules/vite/bin/vite.js'), join(tree, 'node_modules/vite/bin/vite.js')]) {
        if (existsSync(p)) return p;
    }
    throw new Error(`no vite under ${tree}; install the tree first`);
}

async function startServer(side, tree, port) {
    const log = openSync(join(OUT, `server-${side}.log`), 'w');
    const child = spawn(process.execPath, [viteBin(tree), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
        cwd: join(tree, 'packages/web'),
        env: { ...process.env, VITE_XCHAIN_REAL_SDK: '0', BROWSER: 'none' },
        detached: true,
        stdio: ['ignore', log, log],
    });
    servers.push({ side, pid: child.pid, port });
    writeFileSync(join(OUT, 'pids.json'), JSON.stringify(servers, null, 2));
    const url = `http://127.0.0.1:${port}/`;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`${side} dev server exited (${child.exitCode}); see server-${side}.log`);
        try {
            const res = await fetch(url);
            if (res.ok) return url;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${side} dev server did not answer on ${url}`);
}

// ---------------------------------------------------------------- in-page helpers

const FREEZE_CSS = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';

/** Runs before any app code on every document of a context. */
function initScript({ license, surface, popupCss, freezeCss }) {
    try {
        if (license) {
            localStorage.setItem('xc:licenseAcceptedAt', '2026-01-01T00:00:00.000Z');
            localStorage.setItem('xc:licenseAcceptedVersion', license);
        }
    } catch { /* storage unavailable: the gate shows, which the report makes visible */ }
    const apply = () => {
        const root = document.documentElement;
        if (surface === 'sidepanel') root.setAttribute('data-xc-extension-surface', 'sidepanel');
        if (surface === 'popup') root.classList.add('xchain-toolbar-popup');
        if (!document.getElementById('xc-visual-compare')) {
            const style = document.createElement('style');
            style.id = 'xc-visual-compare';
            style.textContent = (surface && popupCss ? popupCss : '') + freezeCss;
            (document.head || root).appendChild(style);
        }
    };
    if (document.documentElement) apply();
    document.addEventListener('DOMContentLoaded', apply);
}

/**
 * Scrolls the document and every vertical scroller to the top or bottom, and
 * reports which one scrolls: a shell whose document scrolls (and so carries
 * its header away) reads differently here than one whose main pane scrolls.
 */
function scrollAll(where) {
    const se = document.scrollingElement || document.documentElement;
    const bottom = where === 'bottom';
    const desc = (el) => {
        let s = el.tagName.toLowerCase();
        if (el.id) s += `#${el.id}`;
        const cls = [...el.classList].slice(0, 2).join('.');
        if (cls) s += `.${cls}`;
        return s;
    };
    const scrollers = [];
    for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (!/(auto|scroll|overlay)/.test(cs.overflowY)) continue;
        if (el.clientHeight < 1 || el.scrollHeight <= el.clientHeight + 1) continue;
        el.scrollTop = bottom ? el.scrollHeight : 0;
        scrollers.push(`${desc(el)}:${el.scrollHeight - el.clientHeight}`);
    }
    window.scrollTo(0, bottom ? se.scrollHeight : 0);
    const header = document.querySelector('header, [role="banner"]');
    const hr = header ? header.getBoundingClientRect() : null;
    return {
        docScrollY: Math.max(0, se.scrollHeight - se.clientHeight),
        docScrollX: Math.max(0, se.scrollWidth - se.clientWidth),
        scrollers: scrollers.slice(0, 4),
        header: hr ? { top: Math.round(hr.top), h: Math.round(hr.height), w: Math.round(hr.width) } : null,
    };
}

// ---------------------------------------------------------------- capture

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

async function settle(page) {
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});
    await page.waitForTimeout(400);
}

function makeShooter(page, side, size, entries) {
    const dir = join(OUT, 'shots', side, size.name);
    mkdirSync(dir, { recursive: true });
    return async function shoot(key, expectedHeading = null) {
        await settle(page);
        if (expectedHeading) await assertScreenHeading(page, expectedHeading);
        for (const phase of ['top', 'bottom']) {
            let metrics = null;
            try { metrics = await page.evaluate(scrollAll, phase); } catch (err) { metrics = { error: String(err.message || err) }; }
            await page.waitForTimeout(phase === 'bottom' ? 250 : 50);
            const file = join(dir, `${slug(key)}-${phase}.png`);
            try {
                await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
                entries.push({ side, size: size.name, screen: key, phase, file, metrics });
            } catch (err) {
                entries.push({ side, size: size.name, screen: key, phase, error: String(err.message || err).slice(0, 200) });
            }
        }
        await page.evaluate(scrollAll, 'top').catch(() => {});
    };
}

async function assertScreenHeading(page, expected) {
    const actual = await page.evaluate(() => {
        const visible = (element) => {
            if (!element) return false;
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden'
                && element.getClientRects().length > 0;
        };
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible);
        if (dialog) {
            const label = dialog.getAttribute('aria-label');
            if (label) return label.trim();
            const labelledBy = dialog.getAttribute('aria-labelledby');
            const labelled = labelledBy && document.getElementById(labelledBy);
            if (labelled?.textContent) return labelled.textContent.trim();
        }
        const headings = [...document.querySelectorAll('h1, [role="heading"][aria-level="1"]')].filter(visible);
        return headings.at(-1)?.textContent?.trim() || null;
    });
    if (actual !== expected) {
        throw new Error(`heading mismatch: expected "${expected}", found ${actual ? `"${actual}"` : 'none'}`);
    }
}

async function newContext(browser, size, opts) {
    const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1,
        isMobile: Boolean(size.touch),
        hasTouch: Boolean(size.touch),
        colorScheme: 'light',
        reducedMotion: 'reduce',
        locale: 'en-US',
        timezoneId: 'UTC',
    });
    await context.route((url) => !/^(127\.0\.0\.1|localhost)$/.test(url.hostname) && /^https?:$/.test(url.protocol), (route) => route.abort());
    await context.addInitScript(initScript, { ...opts, freezeCss: FREEZE_CSS });
    return context;
}

async function dismissCarousel(page) {
    const skip = page.getByRole('button', { name: 'Skip' });
    const welcome = page.getByRole('button', { name: 'Create new wallet' });
    await skip.or(welcome).first().waitFor({ state: 'visible', timeout: 90_000 });
    if (await skip.count() > 0 && await skip.first().isVisible()) {
        await skip.first().click();
        await welcome.waitFor({ state: 'visible', timeout: 15_000 });
    }
}

async function closeOverlays(page) {
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape').catch(() => {});
}

async function openPalette(page) {
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    if (await palette.isVisible().catch(() => false)) return palette;
    const button = page.getByRole('button', { name: 'Open command palette' }).first();
    if (await button.count() > 0 && await button.isVisible().catch(() => false)) {
        await button.click();
    } else {
        await page.keyboard.press('ControlOrMeta+k');
    }
    await palette.waitFor({ state: 'visible', timeout: 10_000 });
    return palette;
}

async function gotoByPalette(page, title) {
    await closeOverlays(page);
    const palette = await openPalette(page);
    await palette.getByRole('combobox').fill(title);
    const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let option = palette.getByRole('option', { name: new RegExp(`^${esc}(\\b|$)`) }).first();
    if (await option.count() === 0) option = palette.getByRole('option').filter({ hasText: title }).first();
    if (await option.count() === 0) {
        await closeOverlays(page);
        throw new Error(`palette offers no "${title}"`);
    }
    await option.click({ timeout: 5_000 });
    await palette.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

/** Labels of the Settings rows, read once from the freshly opened list. */
async function settingsRows(page) {
    const rows = page.locator('main button:visible:not([disabled])');
    const labels = await rows.evaluateAll((els) => els.map((e) => (
        (e.innerText || e.getAttribute('aria-label') || '').trim().split('\n')[0].trim()
    )));
    return [...new Set(labels.filter((l) => l && !/^Back/.test(l) && !DESTRUCTIVE.test(l)))].slice(0, MAX_SETTINGS);
}

async function clickSettingsRow(page, label) {
    const rows = page.locator('main button:visible:not([disabled])');
    const index = await rows.evaluateAll((els, want) => els.findIndex((e) => (
        (e.innerText || e.getAttribute('aria-label') || '').trim().split('\n')[0].trim() === want
    )), label);
    if (index < 0) throw new Error(`no Settings row "${label}"`);
    await rows.nth(index).click({ timeout: 5_000 });
}

async function gotoSettingsScreen(page, label) {
    await gotoByPalette(page, 'Settings');
    await settle(page);
    const back = page.getByRole('button', { name: 'Back to settings' });
    if (await back.count() > 0 && await back.first().isVisible().catch(() => false)) {
        await back.first().click();
        await page.waitForTimeout(250);
    }
    if (label === 'Keyboard') {
        await gotoByPalette(page, 'Settings → Keyboard');
        return 'Keyboard';
    }
    if (label === 'Import…') {
        await page.getByLabel('Import contacts JSON').setInputFiles({
            name: 'contacts.json',
            mimeType: 'application/json',
            buffer: Buffer.from('[]'),
        });
        await page.getByRole('dialog', { name: 'Import contacts?' })
            .waitFor({ state: 'visible', timeout: 5_000 });
        return 'Import contacts?';
    }
    await clickSettingsRow(page, label);
    return label === 'Accounts & addresses' ? 'Accounts' : label;
}

async function captureSize(browser, side, baseUrl, size, tree, entries, skips) {
    const license = (/LICENSE_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(join(tree, 'packages/core/src/buildInfo.js'), 'utf8')) || [])[1] || '2';
    const popupCssPath = join(tree, 'packages/extension/src/popup/popup.css');
    const popupCss = size.surface && existsSync(popupCssPath) ? readFileSync(popupCssPath, 'utf8') : '';
    const url = baseUrl + (size.query || '');
    const skip = (screen, why) => skips.push({ side, size: size.name, screen, why: String(why?.message || why).split('\n')[0].slice(0, 200) });

    // The license page needs a context that has not accepted it.
    if (wantScreen('license')) {
        const ctx = await newContext(browser, size, { surface: size.surface, popupCss });
        const page = await ctx.newPage();
        try {
            await page.goto(url, { timeout: 120_000 });
            await page.waitForTimeout(1_500);
            await makeShooter(page, side, size, entries)('license');
        } catch (err) { skip('license', err); }
        await ctx.close();
    }

    const ctx = await newContext(browser, size, { license, surface: size.surface, popupCss });
    const page = await ctx.newPage();
    const shoot = makeShooter(page, side, size, entries);
    try {
        await page.goto(url, { timeout: 120_000 });
        await page.getByRole('button', { name: 'Skip' }).or(page.getByRole('button', { name: 'Create new wallet' }))
            .first().waitFor({ state: 'visible', timeout: 90_000 });
        if (wantScreen('onboarding')) await shoot('onboarding-start');
        await dismissCarousel(page);
        if (wantScreen('onboarding')) await shoot('onboarding-welcome');
        await page.getByRole('button', { name: 'Try in demo mode' }).click();
        await page.getByRole('region', { name: 'Active address balance' }).first().waitFor({ state: 'visible', timeout: 180_000 });
    } catch (err) {
        skip('demo-entry', err);
        await ctx.close();
        return;
    }

    for (const screen of SCREENS) {
        if (!wantScreen(screen.key)) continue;
        try {
            await gotoByPalette(page, screen.title);
            await shoot(screen.key, screen.heading || screen.title);
        } catch (err) { skip(screen.key, err); continue; }
        if (screen.key !== 'settings') continue;
        let labels = [];
        try { labels = await settingsRows(page); } catch (err) { skip('settings rows', err); }
        for (const label of labels) {
            const key = `settings - ${label}`;
            try {
                const expectedHeading = await gotoSettingsScreen(page, label);
                await shoot(key, expectedHeading);
            } catch (err) { skip(key, err); }
        }
    }
    await ctx.close();
}

async function captureSide(browser, side, tree, baseUrl, entries, skips) {
    for (const size of sizes) {
        const t0 = Date.now();
        try {
            await captureSize(browser, side, baseUrl, size, tree, entries, skips);
        } catch (err) {
            skips.push({ side, size: size.name, screen: '*', why: String(err.message || err).split('\n')[0].slice(0, 200) });
        }
        console.log(`[${side}] ${size.name} done in ${Math.round((Date.now() - t0) / 1000)} s`);
    }
}

// ---------------------------------------------------------------- diff

/**
 * Fraction of pixels that differ by more than the tolerance on any channel,
 * plus a diff image: the baseline faded to grey with changed pixels in red.
 * Images of different sizes are compared over their union, the part one
 * lacks counting as changed.
 */
export function diffPngBuffers(aBuffer, bBuffer, tolerance = 24) {
    const a = PNG.sync.read(aBuffer);
    const b = PNG.sync.read(bBuffer);
    const w = Math.max(a.width, b.width);
    const h = Math.max(a.height, b.height);
    const out = new PNG({ width: w, height: h });
    let changed = 0;
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const o = (y * w + x) * 4;
            const inA = x < a.width && y < a.height;
            const inB = x < b.width && y < b.height;
            const ia = (y * a.width + x) * 4;
            const ib = (y * b.width + x) * 4;
            let diff = !(inA && inB);
            if (!diff) {
                for (let c = 0; c < 3; c += 1) {
                    if (Math.abs(a.data[ia + c] - b.data[ib + c]) > tolerance) { diff = true; break; }
                }
            }
            if (diff) {
                changed += 1;
                out.data[o] = 230; out.data[o + 1] = 20; out.data[o + 2] = 40; out.data[o + 3] = 255;
            } else {
                const g = Math.round(0.3 * a.data[ia] + 0.59 * a.data[ia + 1] + 0.11 * a.data[ia + 2]);
                const faded = Math.round(255 - (255 - g) * 0.25);
                out.data[o] = faded; out.data[o + 1] = faded; out.data[o + 2] = faded; out.data[o + 3] = 255;
            }
        }
    }
    return {
        percent: Number(((changed / (w * h)) * 100).toFixed(3)),
        sizeMismatch: a.width !== b.width || a.height !== b.height,
        image: PNG.sync.write(out),
    };
}

function diffPngs(aFile, bFile, outFile) {
    const result = diffPngBuffers(readFileSync(aFile), readFileSync(bFile), TOLERANCE);
    writeFileSync(outFile, result.image);
    return { percent: result.percent, sizeMismatch: result.sizeMismatch };
}

// ---------------------------------------------------------------- report

const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtMetrics(m) {
    if (!m) return '';
    if (m.error) return `error: ${m.error}`;
    const parts = [`doc scroll ${m.docScrollY}px`];
    if (m.docScrollX) parts.push(`doc x-scroll ${m.docScrollX}px`);
    if (m.header) parts.push(`header ${m.header.h}px at ${m.header.top}`);
    if (m.scrollers?.length) parts.push(`scrollers ${m.scrollers.join(', ')}`);
    return parts.join('; ');
}

export function buildReportIndex(rows, skips, meta, { outDir, tolerance, sizeNames }) {
    const rel = (p) => (p ? relative(outDir, p) : null);
    return {
        ...meta,
        tolerance,
        sizes: sizeNames,
        rows: rows.map((r) => ({
            screen: r.screen, size: r.size, phase: r.phase, percent: r.percent, status: r.status,
            pruned: Boolean(r.pruned),
            baseline: rel(r.baseline), candidate: rel(r.candidate), diff: rel(r.diff),
            baselineMetrics: r.baselineMetrics, candidateMetrics: r.candidateMetrics, note: r.note,
        })),
        skipped: skips,
    };
}

function writeReport(rows, skips, meta) {
    const rel = (p) => (p ? relative(OUT, p) : null);
    const index = buildReportIndex(rows, skips, meta, {
        outDir: OUT,
        tolerance: TOLERANCE,
        sizeNames: sizes.map((s) => s.name),
    });
    writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

    const img = (p, alt, pruned) => {
        if (pruned) return '<div class="none">pruned</div>';
        return p ? `<a href="${escHtml(rel(p))}"><img loading="lazy" src="${escHtml(rel(p))}" alt="${escHtml(alt)}"></a>` : '<div class="none">none</div>';
    };
    const body = rows.map((r) => `
<section class="row ${r.percent >= 5 ? 'hi' : r.percent >= KEEP_THRESHOLD ? 'mid' : 'lo'}${r.pruned ? ' pruned' : ''}">
  <h2><span class="pct">${r.percent === null ? r.status : `${r.percent.toFixed(2)}%`}</span> ${escHtml(r.screen)} <small>${escHtml(r.size)} / ${escHtml(r.phase)}</small>${r.pruned ? ' <span class="tag">pruned</span>' : ''}</h2>
  <p class="m">baseline: ${escHtml(fmtMetrics(r.baselineMetrics))}<br>candidate: ${escHtml(fmtMetrics(r.candidateMetrics))}${r.note ? `<br>${escHtml(r.note)}` : ''}</p>
  <div class="grid">
    <figure>${img(r.baseline, 'baseline', r.pruned)}<figcaption>baseline</figcaption></figure>
    <figure>${img(r.candidate, 'candidate', r.pruned)}<figcaption>candidate</figcaption></figure>
    <figure>${img(r.diff, 'diff', r.pruned)}<figcaption>diff</figcaption></figure>
  </div>
</section>`).join('\n');
    const skipList = skips.length
        ? `<h2>Skipped</h2><ul>${skips.map((s) => `<li>${escHtml(s.side)} ${escHtml(s.size)} ${escHtml(s.screen)}: ${escHtml(s.why)}</li>`).join('')}</ul>`
        : '';
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual compare</title>
<style>
:root { --bg: #fff; --fg: #111; --muted: #555; --line: #ddd; --hi: #c4122f; --mid: #a35d00; --lo: #2d6a2d; }
@media (prefers-color-scheme: dark) { :root { --bg: #111418; --fg: #eee; --muted: #aaa; --line: #333; --hi: #ff6b7f; --mid: #f0b050; --lo: #7fcf7f; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 4px; }
.meta { color: var(--muted); margin: 0 0 16px; }
.row { border-top: 1px solid var(--line); padding: 12px 0; }
.row h2 { font-size: 15px; margin: 0 0 4px; }
.row small { color: var(--muted); font-weight: normal; }
.pct { display: inline-block; min-width: 72px; }
.tag { color: var(--muted); font-size: 11px; font-weight: normal; text-transform: uppercase; }
.hi .pct { color: var(--hi); } .mid .pct { color: var(--mid); } .lo .pct { color: var(--lo); }
.m { color: var(--muted); font-size: 12px; margin: 0 0 8px; overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
figure { margin: 0; } figcaption { color: var(--muted); font-size: 12px; }
img { max-width: 100%; max-height: 640px; border: 1px solid var(--line); display: block; }
.none { color: var(--muted); padding: 24px; border: 1px dashed var(--line); }
</style></head><body>
<h1>Visual compare</h1>
<p class="meta">baseline ${escHtml(meta.baseline)} (${escHtml(meta.baselineHead)})<br>candidate ${escHtml(meta.candidate)} (${escHtml(meta.candidateHead)})<br>
${rows.length} shots, ${rows.filter((r) => r.percent >= KEEP_THRESHOLD).length} differ by ${KEEP_THRESHOLD}% or more, ${rows.filter((r) => r.pruned).length} pruned; tolerance ${TOLERANCE} per channel. Desktop sizes are the web layout at that width: the desktop renderer marks no surface on &lt;html&gt;.</p>
${body}
${skipList}
</body></html>`;
    writeFileSync(join(OUT, 'index.html'), html);
}

// ---------------------------------------------------------------- main

/** The tree's commit, read through git so detached worktrees and branches both resolve. */
function headOf(tree) {
    try {
        return gitHead(tree);
    } catch { return 'unknown'; }
}

function gitHead(tree) {
    const head = execFileSync('git', ['-C', tree, 'rev-parse', '--short=9', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', tree, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
    return dirty ? `${head} plus uncommitted changes` : head;
}

async function main() {
    mkdirSync(join(OUT, 'diff'), { recursive: true });
    const trees = { baseline: resolve(args.baseline), candidate: resolve(args.candidate) };
    const meta = {
        generator: VISUAL_REPORT_GENERATOR,
        baseline: trees.baseline, candidate: trees.candidate,
        baselineHead: headOf(trees.baseline), candidateHead: headOf(trees.candidate),
        startedAt: new Date().toISOString(),
        keepAll: KEEP_ALL, keepThreshold: KEEP_THRESHOLD,
    };
    const [baseUrl, candUrl] = await Promise.all([
        startServer('baseline', trees.baseline, PORT),
        startServer('candidate', trees.candidate, PORT + 1),
    ]);
    const browser = await chromium.launch();
    const entries = [];
    const skips = [];
    try {
        await Promise.all([
            captureSide(browser, 'baseline', trees.baseline, baseUrl, entries, skips),
            captureSide(browser, 'candidate', trees.candidate, candUrl, entries, skips),
        ]);
    } finally {
        await browser.close().catch(() => {});
        stopServers();
    }

    // Pair every baseline shot with its candidate twin.
    const byKey = new Map();
    for (const e of entries) {
        const k = `${e.size}|${e.screen}|${e.phase}`;
        if (!byKey.has(k)) byKey.set(k, {});
        byKey.get(k)[e.side] = e;
    }
    const rows = [];
    for (const [k, pair] of byKey) {
        const [size, screen, phase] = k.split('|');
        const b = pair.baseline; const c = pair.candidate;
        const row = {
            size, screen, phase, percent: null, status: 'ok',
            baseline: b?.file || null, candidate: c?.file || null, diff: null,
            baselineMetrics: b?.metrics || null, candidateMetrics: c?.metrics || null, note: [b?.error, c?.error].filter(Boolean).join('; ') || undefined,
        };
        if (row.baseline && row.candidate) {
            const dfile = join(OUT, 'diff', size, `${slug(screen)}-${phase}.png`);
            mkdirSync(join(OUT, 'diff', size), { recursive: true });
            const d = diffPngs(row.baseline, row.candidate, dfile);
            row.diff = dfile;
            row.percent = d.percent;
            if (d.sizeMismatch) row.note = [row.note, 'image sizes differ'].filter(Boolean).join('; ');
        } else {
            row.status = row.baseline ? 'candidate missing' : 'baseline missing';
        }
        rows.push(row);
    }
    // Missing screens first (a screen that stopped rendering is the loudest
    // change), then by largest difference.
    rows.sort((x, y) => (y.percent ?? 101) - (x.percent ?? 101));
    meta.finishedAt = new Date().toISOString();
    writeReport(rows, skips, meta);
    const pruning = pruneReportRows(rows, {
        keepAll: KEEP_ALL, threshold: KEEP_THRESHOLD,
    });
    const optimization = await optimizePngs(pruning.retained);
    meta.prunedRows = pruning.pruned;
    meta.pngOptimization = optimization;
    writeReport(rows, skips, meta);
    console.log(`report: ${join(OUT, 'index.html')}`);
    console.log(`${rows.length} shots, ${rows.filter((r) => r.percent >= KEEP_THRESHOLD).length} at ${KEEP_THRESHOLD}% or more, ${pruning.pruned} pruned, ${rows.filter((r) => r.percent === null).length} unpaired, ${skips.length} skipped`);
}

if (IS_MAIN) {
    main().catch((err) => {
        console.error(err);
        stopServers();
        process.exit(1);
    });
}
