// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Click crawl: the functional half of the layout sweep. It reaches the same
// screens (Home, every command-palette destination, every Menu row, every
// Settings section) in a demo wallet, presses every control on each one that
// is safe to press, and fills and submits each form as far as its review
// step. Per action it records what a user would call broken:
//
//   - an uncaught page error, or a console.error line;
//   - a failed or 4xx/5xx request to the app's own origin;
//   - an enabled control whose press changes nothing at all (no DOM change,
//     no navigation, no dialog, no new window);
//   - a dialog that neither Escape nor its own close button dismisses;
//   - content pushed off screen, or a page that starts scrolling sideways;
//   - a form that refuses plausible input, or takes plainly invalid input
//     to its review step without a word.
//
// Findings are for a person to judge; the crawl never fails on one.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dismissIntroCarousel, gotoSection, nav, openSettings, unlockedShell } from '../fixtures/wallet.js';
import { measureInPage } from './sweep.js';

/**
 * Never pressed. These lock, delete or reset the wallet, leave demo mode, or
 * sign and broadcast, and a crawl must not do any of that even in a demo.
 */
export const DESTRUCTIVE = /^activate$|^(watcher|signer) \(|\block\b|remove|delete|reset|wipe|erase|sign ?out|log ?out|forget|revoke|uninstall|factory|clear (all|data|history|cache|everything)|exit demo|leave demo|panic|duress|broadcast|send now|confirm|sign and|sign & |approve|authori[sz]e|pay now|burn|destroy/i;

/** Submit labels a crawl may press: they move a form to its review step or save a demo setting. */
const SAFE_SUBMIT = /^(review|continue|next|preview|check|estimate|validate|search|look ?up|save|apply|add|done|ok|verify|calculate|find|go|show|load|test|preview .*|review .*)$/i;

/** The controls a user can press. Nested matches are collapsed in the page. */
const CONTROL_SELECTOR = 'button, [role="tab"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="option"], a[href], summary, input[type="checkbox"], input[type="radio"]';

/**
 * Runs in the page. Lists the controls of the current screen's content in
 * document order, with the facts needed to judge them. Header and nav
 * controls belong to the chrome screen, not to every screen.
 */
function listControlsInPage([selector, includeChrome]) {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')]
        .filter((d) => d.getClientRects().length > 0);
    const scope = dialogs[dialogs.length - 1]
        || [...document.querySelectorAll('main')].find((m) => m.getClientRects().length > 0)
        || document.body;
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
    };
    const inChrome = (el) => Boolean(el.closest('nav, header, [role="navigation"], [role="banner"]'));
    const out = [];
    const all = [...scope.querySelectorAll(selector)];
    all.forEach((el, index) => {
        if (!visible(el)) return;
        if (!includeChrome && inChrome(el) && !el.closest('main')) return;
        // A control inside another control is the same press.
        const outer = el.parentElement?.closest(selector);
        if (outer && scope.contains(outer)) return;
        const labelledBy = el.getAttribute('aria-labelledby');
        const label = (el.getAttribute('aria-label')
            || (labelledBy && document.getElementById(labelledBy)?.innerText)
            || (el.tagName === 'INPUT' ? (el.labels?.[0]?.innerText || '') : '')
            || (el.tagName === 'INPUT' ? '' : (el.innerText || '')).trim().split('\n')[0]
            || el.getAttribute('title') || '').trim().slice(0, 80);
        out.push({
            index,
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || '',
            label,
            disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
            selected: el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true'
                || (el.getAttribute('aria-checked') === 'true' && el.getAttribute('role') === 'radio')
                || (el.type === 'radio' && el.checked === true)
                || ['page', 'true'].includes(el.getAttribute('aria-current')),
            href: el.getAttribute('href') || '',
            type: el.getAttribute('type') || '',
            inForm: Boolean(el.closest('form')),
            checked: typeof el.checked === 'boolean' ? el.checked : null,
        });
    });
    return out;
}

/** Runs in the page: the element behind a listControlsInPage index. */
function controlAt([selector, index]) {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')]
        .filter((d) => d.getClientRects().length > 0);
    const scope = dialogs[dialogs.length - 1]
        || [...document.querySelectorAll('main')].find((m) => m.getClientRects().length > 0)
        || document.body;
    return scope.querySelectorAll(selector)[index] || null;
}

/** Runs in the page: start counting DOM changes. */
function armMutations() {
    window.__xcCrawlMut = 0;
    if (window.__xcCrawlObs) window.__xcCrawlObs.disconnect();
    window.__xcCrawlObs = new MutationObserver((list) => { window.__xcCrawlMut += list.length; });
    window.__xcCrawlObs.observe(document.body, {
        subtree: true, childList: true, attributes: true, characterData: true,
    });
    // A share button's result is the OS share sheet, which a test browser
    // never draws (WebKit has navigator.share but no sheet). Count the call
    // as the visible result and complete it, as a user picking a target would.
    if (typeof navigator.share === 'function' && !navigator.share.__xcCrawl) {
        const shareStub = () => { window.__xcCrawlMut += 1; return Promise.resolve(); };
        shareStub.__xcCrawl = true;
        try { Object.defineProperty(navigator, 'share', { value: shareStub, configurable: true }); } catch { /* leave it */ }
    }
}

/** Runs in the page: what identifies the screen being looked at. */
function screenSignature() {
    const h = [...document.querySelectorAll('main h1, main h2, h1')].find((el) => el.getClientRects().length > 0);
    return `${location.pathname}${location.hash}|${(h?.textContent || '').trim().slice(0, 60)}`;
}

/** Runs in the page: visible open dialogs and sheets. */
function openDialogs() {
    return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => el.getAttribute('aria-label') || el.querySelector('h1,h2,h3')?.textContent?.trim() || el.tagName.toLowerCase());
}

/** Runs in the page: how many dropdowns, menus and popovers are open. */
function openPopups() {
    return [...document.querySelectorAll('[role="listbox"], [role="menu"], [popover]:popover-open, [aria-expanded="true"]')]
        .filter((el) => el.getClientRects().length > 0).length;
}

/** Runs in the page: error text a form is showing. */
function formMessages(formIndex) {
    const form = document.querySelectorAll('main form')[formIndex] || document.querySelectorAll('form')[formIndex];
    const scope = form?.closest('main') || document;
    const texts = new Set();
    for (const el of scope.querySelectorAll('[role="alert"], [aria-invalid="true"], [class*="error"], [class*="Error"]')) {
        if (el.getClientRects().length === 0) continue;
        const t = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 160);
        if (t) texts.add(t);
    }
    return [...texts].slice(0, 6);
}

/**
 * Runs in the page: plausible values for every empty field of one form,
 * chosen from the field's label, name, placeholder and type. Returns the
 * fields it filled so the Node side can type into them for real.
 */
function planFill([formIndex, address, mode]) {
    const forms = [...document.querySelectorAll('main form')];
    const form = forms[formIndex] || document.querySelectorAll('form')[formIndex];
    if (!form) return [];
    const plan = [];
    const fields = [...form.querySelectorAll('input, textarea, select')];
    fields.forEach((el, i) => {
        if (el.disabled || el.readOnly || el.getClientRects().length === 0) return;
        const type = (el.getAttribute('type') || el.tagName).toLowerCase();
        if (['checkbox', 'radio', 'hidden', 'file', 'submit', 'button', 'range', 'color'].includes(type)) return;
        const labelText = [
            el.labels?.[0]?.innerText, el.getAttribute('aria-label'), el.getAttribute('name'),
            el.getAttribute('placeholder'), el.id,
        ].filter(Boolean).join(' ').toLowerCase();
        let value;
        if (el.tagName === 'SELECT') {
            const opts = [...el.options].filter((o) => !o.disabled && o.value !== '');
            if (opts.length > 1) plan.push({ i, kind: 'select', value: opts[1].value, label: labelText });
            return;
        }
        if (el.value && mode === 'valid') return; // keep defaults the form chose
        const invalid = mode === 'invalid';
        if (type === 'password') value = 'crawlpassword123';
        else if (/address|recipient|destination|payee|cosigner|\bto\b|source|owner|issuer|holder/.test(labelText)) value = invalid ? 'not-an-address' : address;
        else if (/supply|quantity|copies|count|max|limit|shares|units/.test(labelText)) value = invalid ? '-5' : '1000';
        else if (/amount|price|fee|rate|value|give|get|deposit|bid|ask|total/.test(labelText)) value = invalid ? '-5' : '0.001';
        else if (/height|block|duration|days|hours|expir|timeout|lock ?time|delay/.test(labelText)) value = invalid ? '-1' : '100';
        else if (/percent|%|ratio|share/.test(labelText)) value = invalid ? '500' : '5';
        else if (/ticker|asset|token|tick|symbol|currency/.test(labelText)) value = invalid ? '!!' : 'CRAWLTEST';
        else if (/url|link|website|endpoint|uri|server/.test(labelText)) value = invalid ? 'not a url' : 'https://example.com';
        else if (/email/.test(labelText)) value = invalid ? 'nope' : 'crawl@example.com';
        else if (/phrase|mnemonic|seed|words/.test(labelText)) return; // never type a phrase
        else if (/hex|psbt|tx|transaction|signature|pubkey|public key|xpub/.test(labelText)) value = invalid ? 'zz' : '';
        else if (type === 'number') value = invalid ? '-5' : '1';
        else if (el.tagName === 'TEXTAREA') value = 'Crawl test';
        else value = invalid ? '' : 'Crawl test';
        if (value === '' && !invalid) return;
        plan.push({ i, kind: 'fill', value, label: labelText.slice(0, 60) });
    });
    return plan;
}

/** Runs in the page: the field behind a planFill index. */
function fieldAt([formIndex, i]) {
    const forms = [...document.querySelectorAll('main form')];
    const form = forms[formIndex] || document.querySelectorAll('form')[formIndex];
    return form ? form.querySelectorAll('input, textarea, select')[i] : null;
}

/** Runs in the page: the form's submit control and its label. */
function submitOf(formIndex) {
    const forms = [...document.querySelectorAll('main form')];
    const form = forms[formIndex] || document.querySelectorAll('form')[formIndex];
    if (!form) return null;
    const buttons = [...form.querySelectorAll('button')].filter((b) => b.getClientRects().length > 0);
    const submit = buttons.find((b) => (b.getAttribute('type') || 'submit') === 'submit') || null;
    if (!submit) return null;
    return {
        index: buttons.indexOf(submit),
        label: (submit.getAttribute('aria-label') || submit.innerText || '').trim().split('\n')[0].slice(0, 60),
        disabled: submit.disabled,
    };
}

/** Runs in the page: the browser's own verdict on a form, if it blocks. */
function nativeInvalid(formIndex) {
    const forms = [...document.querySelectorAll('main form')];
    const form = forms[formIndex] || document.querySelectorAll('form')[formIndex];
    if (!form || form.noValidate || form.checkValidity()) return null;
    const bad = [...form.elements].find((el) => el.validity && !el.validity.valid);
    return bad ? `${bad.getAttribute('aria-label') || bad.name || bad.type}: ${bad.validationMessage}` : 'invalid';
}

function submitButtonAt([formIndex, index]) {
    const forms = [...document.querySelectorAll('main form')];
    const form = forms[formIndex] || document.querySelectorAll('form')[formIndex];
    return form ? [...form.querySelectorAll('button')].filter((b) => b.getClientRects().length > 0)[index] : null;
}

/**
 * The useful part of a Playwright click failure: its call log says which
 * element took the pointer, or that the target never settled.
 */
function clickReason(err) {
    const lines = String(err?.message || err).split('\n').map((l) => l.trim());
    const why = lines.filter((l) => /intercepts pointer events|not stable|not visible|outside of the viewport|not enabled|detached|waiting for/.test(l));
    const pick = why.filter((l) => !/^- waiting for (locator|element)/.test(l)).slice(-2);
    return [lines[0], ...pick].join(' / ').slice(0, 300);
}

/**
 * A crawl bound to one page. `screens` are discovered once and then crawled
 * in the order given; the caller picks its shard of them. `start` replaces
 * the default `page.goto('/')` for a venue with no dev-server URL (the
 * Electron app, which reloads its own page and passes its licence gate).
 */
// WebKit reports every failed load twice: once with the URL through the
// request events below (where the app's own origin is judged), and again as
// a console line or page error with no URL ("Failed to load resource: ...
// 404", "Origin ... is not allowed by Access-Control-Allow-Origin", "Fetch API
// cannot load ... due to access control checks") even when the app catches the
// rejection. Those carry no way to tell an own-origin failure from a third
// party's, so they are left to the request events.
export function isWebKitNetworkNoise(text) {
    return /^Failed to load resource\b/.test(text)
        || /is not allowed by Access-Control-Allow-Origin/.test(text)
        || /due to access control checks\.?$/.test(text);
}

/**
 * Opens a known screen. Desktop can reopen palette destinations directly,
 * avoiding a Home transition for every control that leaves the screen.
 */
export async function reachKnownScreen(screen, {
    reentry = false,
    directReentry = false,
    home,
    settle,
}) {
    if (reentry && directReentry && screen.reopen) {
        await screen.reopen();
        await settle(100);
        return;
    }
    await home();
    await screen.open();
    await settle(500);
}

/** Selects the first balance offered by an empty TokenField in one form. */
export async function chooseFirstOfferedToken(page, formIndex) {
    const mainForms = page.locator('main form');
    const form = (await mainForms.count()) > 0
        ? mainForms.nth(formIndex)
        : page.locator('form').nth(formIndex);
    const field = form.locator('button[aria-label$=": Select a token"]').first();
    if ((await field.count()) === 0) return null;

    const label = await field.getAttribute('aria-label');
    await field.click({ timeout: 3_000 });
    const firstToken = page.getByRole('list', { name: 'Balances' }).getByRole('listitem').first();
    try {
        await firstToken.click({ timeout: 10_000 });
        return label || 'Select a token';
    } catch {
        await page.getByRole('button', { name: /^Back/ }).first().click({ timeout: 2_000 }).catch(() => {});
        return null;
    }
}

export function createCrawl(page, {
    venue,
    outDir,
    origin,
    start = null,
    directReentry = false,
}) {
    mkdirSync(outDir, { recursive: true });
    const findings = [];
    const covered = [];
    let action = 'start';
    const events = [];

    page.on('pageerror', (err) => {
        const text = String(err?.message || err);
        if (isWebKitNetworkNoise(text)) return;
        events.push({ action, kind: 'page error', text: text.slice(0, 300) });
    });
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (isWebKitNetworkNoise(msg.text())) return;
        events.push({ action, kind: 'console.error', text: msg.text().slice(0, 300) });
    });
    page.on('requestfailed', (req) => {
        if (!req.url().startsWith(origin)) return;
        events.push({ action, kind: 'request failed', text: `${req.method()} ${req.url().slice(origin.length)} ${req.failure()?.errorText || ''}` });
    });
    page.on('response', (res) => {
        if (!res.url().startsWith(origin) || res.status() < 400) return;
        events.push({ action, kind: `HTTP ${res.status()}`, text: `${res.request().method()} ${res.url().slice(origin.length)}` });
    });
    // A control that opens a new window did something; close it again.
    page.context().on('page', (p) => {
        events.push({ action, kind: 'new window', text: p.url(), benign: true });
        p.close().catch(() => {});
    });
    // A file picker is the press doing its job; dismiss it unanswered.
    page.on('filechooser', () => {
        events.push({ action, kind: 'file chooser', text: '', benign: true });
    });
    page.on('dialog', (d) => {
        events.push({ action, kind: 'native dialog', text: `${d.type()}: ${d.message().slice(0, 200)}` });
        d.dismiss().catch(() => {});
    });

    const finding = (screen, control, symptom, detail = {}) => {
        findings.push({ venue, screen, control, symptom, ...detail });
    };

    /**
     * Events raised since `mark`, excluding benign ones, one per distinct
     * kind and text: a render loop logs the same error hundreds of times.
     */
    const since = (mark) => {
        const seen = new Set();
        return events.slice(mark).filter((e) => {
            if (e.benign) return false;
            const key = `${e.kind}|${e.text}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    async function enterDemo() {
        if (start) await start();
        else await page.goto('/');
        const demo = page.getByRole('button', { name: 'Try in demo mode' });
        await demo.or(unlockedShell(page)).or(page.getByRole('button', { name: 'Skip' })).first()
            .waitFor({ state: 'visible', timeout: 60_000 });
        if (await unlockedShell(page).isVisible().catch(() => false)) return;
        await dismissIntroCarousel(page);
        await demo.click();
        await unlockedShell(page).waitFor({ state: 'visible', timeout: 120_000 });
    }

    /** Back to an unlocked Home, by reload if nothing gentler works. */
    async function home() {
        for (let i = 0; i < 2; i += 1) await page.keyboard.press('Escape').catch(() => {});
        if (!page.url().startsWith(origin)) {
            await enterDemo();
            return;
        }
        try {
            if (await nav(page).count() > 0) {
                await gotoSection(page, 'Home');
                await unlockedShell(page).waitFor({ state: 'visible', timeout: 5_000 });
                return;
            }
        } catch { /* fall through to a reload */ }
        await enterDemo();
    }

    const paletteButton = () => page.getByRole('button', { name: 'Open command palette' }).first();
    const palette = () => page.getByRole('dialog', { name: 'Command palette' });
    async function openPalette(timeout = 10_000) {
        if (await paletteButton().isVisible().catch(() => false)) {
            await paletteButton().click({ timeout });
        } else await page.keyboard.press('ControlOrMeta+k');
        await palette().waitFor({ state: 'visible', timeout });
    }

    /** Every screen the sweep reaches, each with a way to open it from Home. */
    async function discover() {
        const screens = [{ label: 'home', open: async () => {} }];
        screens.push({ label: 'chrome: header and nav', open: async () => {}, chrome: true });

        await openPalette();
        let destinations = await palette().getByRole('option').evaluateAll((els) => els
            .map((e) => (e.querySelector('[class*="title"], [class*="label"]')?.textContent || e.textContent || '').trim()));
        destinations = [...new Set(destinations.filter((x) => x && !/^\d/.test(x)))];
        await page.keyboard.press('Escape');
        // Every coin and token has a palette entry, and they all open the
        // same detail screen; two per chain cover it.
        const perChain = new Map();
        for (const dest of destinations) {
            if (DESTRUCTIVE.test(dest)) continue;
            const chain = dest.match(/ on (\w+)$/)?.[1];
            if (chain) {
                perChain.set(chain, (perChain.get(chain) || 0) + 1);
                if (perChain.get(chain) > 2) continue;
            }
            const openDestination = async (timeout = 10_000) => {
                await openPalette(timeout);
                await palette().getByRole('combobox').fill(dest, { timeout });
                await palette().getByRole('option').filter({ hasText: dest }).first()
                    .click({ timeout: Math.min(timeout, 5_000) });
            };
            screens.push({
                label: `palette: ${dest}`,
                open: openDestination,
                reopen: () => openDestination(2_000),
            });
        }

        const menu = paletteButton().page().getByRole('button', { name: 'Open menu' }).first();
        if (await menu.isVisible().catch(() => false)) {
            await menu.click();
            await page.waitForTimeout(300);
            const rows = await page.locator('main button:visible:not([disabled])').evaluateAll((els) => els
                .map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().split('\n')[0].trim()));
            await home();
            for (const row of [...new Set(rows)]) {
                if (!row || /^Back/.test(row) || DESTRUCTIVE.test(row)) continue;
                screens.push({
                    label: `menu: ${row}`,
                    open: async () => {
                        await page.getByRole('button', { name: 'Open menu' }).first().click();
                        await page.waitForTimeout(300);
                        await page.locator('main button:visible').filter({ hasText: row }).first().click({ timeout: 5_000 });
                    },
                });
            }
        }

        await openSettings(page);
        const sections = await page.locator('main button:visible:not([disabled])').evaluateAll((els) => els
            .map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().split('\n')[0].trim()));
        await home();
        for (const section of [...new Set(sections)]) {
            if (!section || /^Back/.test(section) || DESTRUCTIVE.test(section)) continue;
            screens.push({
                label: `settings: ${section}`,
                open: async () => {
                    await openSettings(page);
                    // Settings reopens on the last section it showed.
                    const back = page.getByRole('button', { name: 'Back to settings' });
                    if (await back.isVisible().catch(() => false)) await back.click();
                    await page.locator('main button:visible').filter({ hasText: section }).first().click({ timeout: 5_000 });
                },
            });
        }
        writeFileSync(join(outDir, 'screens.json'), `${JSON.stringify(screens.map((x) => x.label), null, 2)}\n`);
        return screens;
    }

    /** Opens a screen and gives its route a beat to settle. */
    async function reach(screen, reentry = false) {
        await reachKnownScreen(screen, {
            reentry,
            directReentry,
            home,
            settle: (ms) => page.waitForTimeout(ms),
        });
    }

    /** One wallet address to type wherever a form wants one. */
    async function findAddress() {
        const text = await page.locator('body').innerText().catch(() => '');
        const m = text.match(/\b(bc1|tb1|bcrt1|ltc1|tltc1|rltc1)[0-9a-z]{20,80}\b|\b[13mnD2LM][1-9A-HJ-NP-Za-km-z]{25,40}\b/);
        return m ? m[0] : 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    }

    async function pressControls(screen) {
        const label = screen.label;
        await reach(screen);
        const signature = await page.evaluate(screenSignature);
        const baseline = await page.evaluate(measureInPage).catch(() => null);
        const controls = await page.evaluate(listControlsInPage, [CONTROL_SELECTOR, Boolean(screen.chrome)]);
        // A control is addressed by its label and which occurrence of that
        // label it is, so a press that hides or adds something above it
        // does not send the next press to the wrong control.
        const seenLabels = new Map();
        for (const c of controls) {
            c.nth = seenLabels.get(c.label) || 0;
            seenLabels.set(c.label, c.nth + 1);
        }
        const locate = async (c) => {
            const now = await page.evaluate(listControlsInPage, [CONTROL_SELECTOR, Boolean(screen.chrome)]);
            const same = now.filter((x) => x.label === c.label);
            return same[c.nth] || null;
        };
        let pressed = 0;
        for (const c of controls) {
            const name = c.label || `${c.tag}#${c.index}`;
            if (c.disabled) continue;
            if (DESTRUCTIVE.test(c.label)) continue;
            if (c.type === 'submit' && c.inForm) continue; // the form pass submits forms
            if (c.href && /^https?:/.test(c.href) && !c.href.startsWith(origin)) {
                covered.push({ screen: label, control: name, result: 'external link, not followed' });
                continue;
            }
            action = `${label} > ${name}`;
            try {
                if ((await page.evaluate(screenSignature)) !== signature) await reach(screen, true);
                let here = await locate(c);
                if (!here) {
                    await reach(screen, true);
                    here = await locate(c);
                }
                if (!here || here.disabled) {
                    covered.push({ screen: label, control: name, result: here ? 'disabled now; skipped' : 'gone after reset; skipped' });
                    continue;
                }
                const el = (await page.evaluateHandle(controlAt, [CONTROL_SELECTOR, here.index])).asElement();
                if (!el) continue;
                const mark = events.length;
                const urlBefore = page.url();
                const dialogsBefore = await page.evaluate(openDialogs);
                const popupsBefore = await page.evaluate(openPopups).catch(() => 0);
                await page.evaluate(armMutations);
                try {
                    await el.click({ timeout: 3_000 });
                } catch (err) {
                    finding(label, name, 'control cannot be pressed', { error: clickReason(err) });
                    await reach(screen, true);
                    continue;
                }
                pressed += 1;
                await page.waitForTimeout(700);
                const mutations = await page.evaluate(() => window.__xcCrawlMut || 0).catch(() => -1);
                const checkedNow = here.checked === null ? null : await el.evaluate((e) => e.checked).catch(() => null);
                const toggled = here.checked !== null && checkedNow !== null && checkedNow !== here.checked;
                const urlAfter = page.url();
                const dialogsAfter = await page.evaluate(openDialogs).catch(() => []);
                const newWindow = events.slice(mark).some((e) => e.kind === 'new window' || e.kind === 'file chooser');
                for (const e of since(mark)) finding(label, name, e.kind, { error: e.text });
                const changed = mutations !== 0 || toggled || urlAfter !== urlBefore || dialogsAfter.length !== dialogsBefore.length || newWindow;
                if (!changed && !c.selected && c.role !== 'option') {
                    finding(label, name, 'press changed nothing');
                }
                if (!c.label) finding(label, `${c.tag}${c.type ? `[${c.type}]` : ''} #${c.index}`, 'control has no accessible name');
                if (urlAfter.startsWith(origin)) {
                    const after = await page.evaluate(measureInPage).catch(() => null);
                    if (after && baseline) {
                        if (after.pageScrollX > (baseline.pageScrollX || 0) + 1) {
                            finding(label, name, 'page scrolls sideways after the press', { by: after.pageScrollX });
                        }
                        const before = new Set((baseline.offscreen || []).map((o) => o.el));
                        const fresh = (after.offscreen || []).filter((o) => !before.has(o.el));
                        if (fresh.length > 0) finding(label, name, 'content off screen after the press', { items: fresh.slice(0, 4) });
                    }
                }
                covered.push({ screen: label, control: name, result: changed ? 'changed' : 'no change' });
                if (/^(hide|show) /i.test(c.label) && urlAfter === urlBefore && dialogsAfter.length === dialogsBefore.length) {
                    const inverse = /^hide/i.test(c.label) ? c.label.replace(/^hide/i, 'Show') : c.label.replace(/^show/i, 'Hide');
                    const back = page.getByRole('button', { name: inverse, exact: true }).first();
                    if (await back.isVisible().catch(() => false)) await back.click().catch(() => {});
                }
                // A dropdown the press opened would cover the next control:
                // close it the way a user would, or start the screen over.
                if (dialogsAfter.length === dialogsBefore.length
                    && (await page.evaluate(openPopups).catch(() => 0)) > popupsBefore) {
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(200);
                    if ((await page.evaluate(openPopups).catch(() => 0)) > popupsBefore) await reach(screen, true);
                }
                if (dialogsAfter.length > dialogsBefore.length) {
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(300);
                    let still = await page.evaluate(openDialogs).catch(() => []);
                    if (still.length > dialogsBefore.length) {
                        const close = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').last()
                            .getByRole('button', { name: /close|cancel|dismiss|done|not now|back/i }).first();
                        const hasClose = await close.count() > 0;
                        if (hasClose) await close.click({ timeout: 2_000 }).catch(() => {});
                        await page.waitForTimeout(300);
                        still = await page.evaluate(openDialogs).catch(() => []);
                        finding(label, name, hasClose && still.length <= dialogsBefore.length
                            ? 'dialog ignores Escape (its close button works)'
                            : 'dialog cannot be closed', { dialog: dialogsAfter[dialogsAfter.length - 1] });
                    }
                }
            } catch (err) {
                finding(label, name, 'crawl error', { error: String(err?.message || err).split('\n')[0].slice(0, 200) });
                await reach(screen, true).catch(() => {});
            }
        }
        return { controls: controls.length, pressed };
    }

    async function fillForms(screen) {
        const label = screen.label;
        await reach(screen);
        const formCount = await page.evaluate(() => document.querySelectorAll('main form').length
            || document.querySelectorAll('form').length);
        const address = await findAddress();
        for (let f = 0; f < formCount; f += 1) {
            for (const mode of ['valid', 'invalid']) {
                action = `${label} > form ${f + 1} (${mode})`;
                try {
                    await reach(screen, true);
                    const pickedToken = mode === 'valid'
                        ? await chooseFirstOfferedToken(page, f)
                        : null;
                    const plan = await page.evaluate(planFill, [f, address, mode]);
                    if (plan.length === 0 && !pickedToken) break;
                    for (const step of plan) {
                        const field = (await page.evaluateHandle(fieldAt, [f, step.i])).asElement();
                        if (!field) continue;
                        if (step.kind === 'select') await field.selectOption(step.value).catch(() => {});
                        else await field.fill(step.value, { timeout: 2_000 }).catch(() => {});
                    }
                    await page.waitForTimeout(300);
                    const submit = await page.evaluate(submitOf, f);
                    if (!submit) {
                        covered.push({ screen: label, control: `form ${f + 1}`, result: 'no submit button' });
                        break;
                    }
                    if (!SAFE_SUBMIT.test(submit.label)) {
                        covered.push({ screen: label, control: `form ${f + 1} "${submit.label}"`, result: 'submit not pressed (may sign or broadcast)' });
                        break;
                    }
                    if (submit.disabled) {
                        if (mode === 'valid') {
                            finding(label, `form ${f + 1} "${submit.label}"`, 'submit stays disabled after plausible input',
                                {
                                    filled: [
                                        ...plan.map((p) => `${p.label || '?'}=${p.value}`),
                                        ...(pickedToken ? [pickedToken] : []),
                                    ].slice(0, 8),
                                    messages: await page.evaluate(formMessages, f),
                                });
                        }
                        break;
                    }
                    const mark = events.length;
                    const dialogsBefore = await page.evaluate(openDialogs);
                    const sigBefore = await page.evaluate(screenSignature);
                    const blocked = await page.evaluate(nativeInvalid, f);
                    const btn = (await page.evaluateHandle(submitButtonAt, [f, submit.index])).asElement();
                    await page.evaluate(armMutations);
                    await btn.click({ timeout: 3_000 });
                    await page.waitForTimeout(1_200);
                    const reacted = (await page.evaluate(() => window.__xcCrawlMut || 0).catch(() => 0)) > 0;
                    const messages = await page.evaluate(formMessages, f).catch(() => []);
                    const dialogsAfter = await page.evaluate(openDialogs).catch(() => []);
                    const sigAfter = await page.evaluate(screenSignature).catch(() => sigBefore);
                    const advanced = dialogsAfter.length > dialogsBefore.length || sigAfter !== sigBefore;
                    for (const e of since(mark)) finding(label, `form ${f + 1} "${submit.label}" (${mode})`, e.kind, { error: e.text });
                    let result = 'no visible result';
                    if (advanced) result = 'advanced';
                    else if (blocked) result = `browser validation: ${blocked}`;
                    else if (messages.length) result = `messages: ${messages.join(' | ')}`;
                    else if (reacted) result = 'screen updated in place';
                    covered.push({ screen: label, control: `form ${f + 1} "${submit.label}" (${mode})`, result });
                    if (mode === 'invalid' && advanced && messages.length === 0
                        && plan.some((p) => p.value === 'not-an-address' || p.value === '-5')) {
                        finding(label, `form ${f + 1} "${submit.label}"`, 'invalid input reached the next step without an error',
                            { filled: plan.map((p) => `${p.label || '?'}=${p.value}`).slice(0, 8) });
                    }
                    if (mode === 'valid' && !advanced && !reacted && !blocked && messages.length === 0) {
                        finding(label, `form ${f + 1} "${submit.label}"`, 'submit with plausible input shows nothing',
                            { filled: plan.map((p) => `${p.label || '?'}=${p.value}`).slice(0, 8) });
                    }
                    for (let i = 0; i < 2; i += 1) await page.keyboard.press('Escape').catch(() => {});
                } catch (err) {
                    finding(label, `form ${f + 1} (${mode})`, 'crawl error', { error: String(err?.message || err).split('\n')[0].slice(0, 200) });
                }
            }
        }
        return formCount;
    }

    async function crawlScreen(screen) {
        action = `${screen.label} > open`;
        const mark = events.length;
        try {
            await reach(screen);
        } catch (err) {
            finding(screen.label, '(open)', 'screen could not be opened', { error: clickReason(err) });
            return;
        }
        for (const e of since(mark)) finding(screen.label, '(open)', e.kind, { error: e.text });
        const { controls, pressed } = await pressControls(screen);
        const forms = screen.chrome ? 0 : await fillForms(screen);
        covered.push({ screen: screen.label, control: '(screen)', result: `${controls} controls, ${pressed} pressed, ${forms} forms` });
    }

    function write(shardName) {
        writeFileSync(join(outDir, `findings-${shardName}.json`), `${JSON.stringify(findings, null, 2)}\n`);
        writeFileSync(join(outDir, `covered-${shardName}.json`), `${JSON.stringify(covered, null, 2)}\n`);
    }

    return { enterDemo, discover, crawlScreen, write, findings, covered };
}
