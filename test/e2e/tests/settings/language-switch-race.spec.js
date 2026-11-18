// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Language control under pressure: rapid and repeated picks, two tabs,
// a locale chunk that is missing, slow or offline, and the wallet's own
// lifecycle (lock, unlock, reload, hidden and visible). The last pick always
// wins, the root lang and dir always match the locale on screen, and no raw
// message key ever paints.
//
// The registered locales are English and the developer pseudo-RTL mirror,
// which loads as a lazy chunk, so every case drives that pair.
// PROBE_FAMILY (race, network or lifecycle) narrows a run to one group.

import {
    createWallet,
    DEFAULT_PASSWORD,
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedAnyScreen,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const FAMILY = process.env.PROBE_FAMILY || '';
const PSEUDO_CHUNK = '**/locales/pseudo-rtl/**';
const RAW_KEY = /\b(?:settings|common|nav|home|receive|send|shell|errors|locked|onboarding|firstPaint)\.[a-z][A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\b/;

test.use({ viewport: { width: 360, height: 800 } });

function languageList(page) {
    return page.locator('[data-settings-choice-list]');
}

function languageChoice(page, code) {
    return languageList(page).locator(`[data-settings-choice="${code}"] button`);
}

async function expectSelectedLanguage(page, code) {
    await expect(languageChoice(page, code)).toHaveAttribute('aria-current', 'true');
}

async function openLanguageFromAppearance(page) {
    await page.getByRole('main').getByRole('button', { name: /Language/ }).click();
    await expect(languageList(page)).toBeVisible();
}

async function pickLanguage(page, code) {
    await languageChoice(page, code).click();
    await expect(languageList(page)).toBeHidden();
}

async function raceLanguagePicks(page, codes) {
    await languageList(page).evaluate((list, picks) => {
        const choices = new Map([...list.querySelectorAll('[data-settings-choice]')]
            .map((item) => [item.getAttribute('data-settings-choice'), item.querySelector('button')]));
        for (const code of picks) {
            const button = choices.get(code);
            if (!button) throw new Error(`Language choice ${code} is missing`);
            button.click();
        }
    }, codes);
}

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function openLanguageWithDeveloperMode(page) {
    await gotoSection(page, 'Settings');
    await page.getByRole('main').getByRole('button', { name: /^Advanced\b/ }).click();
    const developerMode = page.getByRole('switch', { name: 'Developer mode', exact: true });
    if (!(await developerMode.isChecked())) {
        await developerMode.click();
        await expect(developerMode).toBeChecked();
    }
    // Back once: the switch lives on the Advanced group page.
    const back = page.getByRole('button', { name: 'Back to settings', exact: true }).filter({ visible: true }).first();
    await back.click();
    // Language is a row on the Appearance group page.
    await page.getByRole('main').getByRole('button', { name: /^Appearance\b/ }).click();
    await page.getByRole('main').getByRole('button', { name: /^Language\b/ }).click();
    await expect(languageList(page)).toBeVisible();
}

/** Root metadata, visible stale or raw strings, and the cached language. */
function snapshot(page) {
    return page.evaluate((rawSource) => {
        const raw = new RegExp(rawSource);
        const text = document.body.innerText || '';
        let cached = null;
        try { cached = localStorage.getItem('xc:language'); } catch { /* blocked */ }
        return {
            lang: document.documentElement.lang,
            dir: document.documentElement.dir,
            pseudo: text.includes('⟦'),
            rawKey: (text.match(raw) || [null])[0],
            blank: text.trim().length === 0,
            cached,
        };
    }, RAW_KEY.source);
}

async function expectLocale(page, code, where) {
    const want = code === 'pseudo-rtl'
        ? { lang: 'en', dir: 'rtl', pseudo: true }
        : { lang: 'en', dir: 'ltr', pseudo: false };
    await expect.poll(async () => {
        const s = await snapshot(page);
        return { lang: s.lang, dir: s.dir, pseudo: s.pseudo };
    }, { message: `${where}: root metadata and copy match ${code}` }).toEqual(want);
    const s = await snapshot(page);
    expect(s.rawKey, `${where}: raw message key on screen`).toBeNull();
    expect(s.blank, `${where}: blank screen`).toBe(false);
    return s;
}

async function reloadAndOpen(page) {
    await page.reload();
    const unlock = page.getByRole('button', { name: /Unlock Wallet/ });
    await expect(unlock.or(unlockedAnyScreen(page)).first()).toBeVisible({ timeout: 120_000 });
    return unlock;
}

/** Records every raw message key that paints from the first frame of a load. */
async function watchRawKeys(page) {
    await page.addInitScript((rawSource) => {
        const raw = new RegExp(rawSource);
        window.__rawKeyHits = [];
        // Only painted text counts: script, style and template bodies never render.
        const HIDDEN = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
        const scan = (node) => {
            const host = node.nodeType === 3 ? node.parentElement : node;
            if (!host || HIDDEN.has(host.tagName) || host.closest?.('script, style, template, noscript')) return;
            let text = '';
            if (node.nodeType === 3) text = node.data;
            else {
                const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
                for (let t = walker.nextNode(); t; t = walker.nextNode()) {
                    if (!t.parentElement || !t.parentElement.closest('script, style, template, noscript')) text += ` ${t.data}`;
                }
            }
            const m = text && text.match(raw);
            if (m) window.__rawKeyHits.push(`${m[0]} in <${host.tagName}>`);
        };
        new MutationObserver((records) => {
            for (const r of records) {
                if (r.type === 'characterData') scan(r.target);
                for (const n of r.addedNodes || []) scan(n);
            }
        }).observe(document, { childList: true, subtree: true, characterData: true });
    }, RAW_KEY.source);
}

test.describe('race', () => {
    test.skip(FAMILY !== '' && FAMILY !== 'race', 'other family');

    test('en, pseudo-rtl, en inside 100 ms ends in English and persists it', async ({ page }) => {
        test.setTimeout(240_000);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await openLanguageWithDeveloperMode(page);

        // First pass: dispatch the choice rows in one task while the pseudo
        // chunk is cold. The page may return, but the newest row still wins.
        const started = Date.now();
        await raceLanguagePicks(page, ['en', 'pseudo-rtl', 'en']);
        expect(Date.now() - started).toBeLessThan(100);
        await settle(page);
        await page.waitForLoadState('networkidle');
        let s = await expectLocale(page, 'en', 'cold chunk race');
        await openLanguageFromAppearance(page);
        await expectSelectedLanguage(page, 'en');

        // Warm the chunk, then race again with every pick synchronous.
        await pickLanguage(page, 'pseudo-rtl');
        await expectLocale(page, 'pseudo-rtl', 'warm pick');
        await openLanguageFromAppearance(page);
        await expectSelectedLanguage(page, 'pseudo-rtl');
        await raceLanguagePicks(page, ['en', 'pseudo-rtl', 'en']);
        s = await expectLocale(page, 'en', 'warm chunk race');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('en');

        // Ending on the RTL pick instead.
        await openLanguageFromAppearance(page);
        await expectSelectedLanguage(page, 'en');
        await raceLanguagePicks(page, ['pseudo-rtl', 'en', 'pseudo-rtl']);
        await expectLocale(page, 'pseudo-rtl', 'race ending on RTL');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('pseudo-rtl');
        await openLanguageFromAppearance(page);
        await expectSelectedLanguage(page, 'pseudo-rtl');

        await reloadAndOpen(page);
        s = await expectLocale(page, 'pseudo-rtl', 'after reload');
        expect(s.cached).toBe('pseudo-rtl');
    });

    test('repeated list picks of one language keep it', async ({ page }) => {
        test.setTimeout(240_000);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await openLanguageWithDeveloperMode(page);
        await raceLanguagePicks(page, Array(5).fill('pseudo-rtl'));
        await expectLocale(page, 'pseudo-rtl', 'repeat RTL picks');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('pseudo-rtl');
        await openLanguageFromAppearance(page);
        await expectSelectedLanguage(page, 'pseudo-rtl');
        await raceLanguagePicks(page, Array(5).fill('en'));
        await expectLocale(page, 'en', 'repeat English picks');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('en');
        await openLanguageFromAppearance(page);
        await expectSelectedLanguage(page, 'en');
    });

    test('two tabs of one context end on the last pick', async ({ page, context }) => {
        test.setTimeout(300_000);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await openLanguageWithDeveloperMode(page);
        await pickLanguage(page, 'pseudo-rtl');
        await expectLocale(page, 'pseudo-rtl', 'tab one picks RTL');

        const second = await context.newPage();
        await second.goto('/');
        const unlock = second.getByRole('button', { name: /Unlock Wallet/ });
        await expect(unlock.or(unlockedAnyScreen(second)).first()).toBeVisible({ timeout: 120_000 });
        // A fresh tab opens on the language the wallet last saved.
        await expectLocale(second, 'pseudo-rtl', 'tab two opens');
        const secondUnlocked = !(await unlock.isVisible());
        test.info().annotations.push({ type: 'tab-two', description: secondUnlocked ? 'unlocked' : 'locked' });

        // Tab one switches back last; a reload of either tab shows that pick.
        await openLanguageFromAppearance(page);
        await pickLanguage(page, 'en');
        await expectLocale(page, 'en', 'tab one picks English');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('en');
        await reloadAndOpen(second);
        await expectLocale(second, 'en', 'tab two after reload');
        await reloadAndOpen(page);
        await expectLocale(page, 'en', 'tab one after reload');
    });
});

test.describe('network', () => {
    test.skip(FAMILY !== '' && FAMILY !== 'network', 'other family');

    test('a 404 chunk keeps English and LTR, and a later pick loads it', async ({ page }) => {
        test.setTimeout(240_000);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await openLanguageWithDeveloperMode(page);
        let block = true;
        let requests = 0;
        await page.route(PSEUDO_CHUNK, (route) => {
            requests += 1;
            if (block) return route.fulfill({ status: 404, body: 'missing' });
            return route.continue();
        });
        await languageChoice(page, 'pseudo-rtl').click();
        await expect.poll(() => requests).toBeGreaterThan(0);
        await settle(page);
        await expectLocale(page, 'en', 'after 404');
        await expectSelectedLanguage(page, 'en');
        expect((await snapshot(page)).cached).toBe('en');

        block = false;
        const before = requests;
        await languageChoice(page, 'pseudo-rtl').click();
        await expect.poll(() => requests, {
            message: 'the retry after a 404 requests the locale chunk again',
            timeout: 15_000,
        }).toBeGreaterThan(before);
        await expectLocale(page, 'pseudo-rtl', 'retry after 404');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('pseudo-rtl');
    });

    test('an 8 s chunk delay keeps the UI usable and a newer pick wins', async ({ page }) => {
        test.setTimeout(240_000);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await openLanguageWithDeveloperMode(page);
        let delayed = 0;
        await page.route(PSEUDO_CHUNK, async (route) => {
            delayed += 1;
            await new Promise((resolve) => setTimeout(resolve, 8_000));
            await route.continue().catch(() => {});
        });

        // Slow chunk, then the English row in the same task: English must stay.
        await raceLanguagePicks(page, ['pseudo-rtl', 'en']);
        await expect.poll(() => delayed).toBeGreaterThan(0);
        await expectLocale(page, 'en', 'while the chunk is delayed');
        await page.waitForLoadState('networkidle');
        await expect.poll(() => page.evaluate(() => document.documentElement.dir), { timeout: 20_000 }).toBe('ltr');
        await expectLocale(page, 'en', 'after the delayed chunk lands behind a newer pick');
        expect((await snapshot(page)).cached).toBe('en');

        // Slow chunk with no newer pick: it applies when it lands.
        await openLanguageFromAppearance(page);
        await pickLanguage(page, 'pseudo-rtl');
        await expect.poll(async () => (await snapshot(page)).dir, { timeout: 20_000 }).toBe('rtl');
        await expectLocale(page, 'pseudo-rtl', 'after the delayed chunk lands');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('pseudo-rtl');
    });

    test('an offline chunk failure keeps English and a pick after reconnect loads it', async ({ page, context }) => {
        test.setTimeout(240_000);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await openLanguageWithDeveloperMode(page);
        let offline = true;
        let requests = 0;
        await page.route(PSEUDO_CHUNK, (route) => {
            requests += 1;
            return offline ? route.abort('internetdisconnected') : route.continue();
        });
        await context.setOffline(true);
        await languageChoice(page, 'pseudo-rtl').click();
        await settle(page);
        await expectLocale(page, 'en', 'offline pick');
        await expectSelectedLanguage(page, 'en');

        await context.setOffline(false);
        offline = false;
        const before = requests;
        await languageChoice(page, 'pseudo-rtl').click();
        await expect.poll(() => requests, {
            message: 'the pick after reconnect requests the locale chunk again',
            timeout: 15_000,
        }).toBeGreaterThan(before);
        await expectLocale(page, 'pseudo-rtl', 'pick after reconnect');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('pseudo-rtl');
    });
});

test.describe('lifecycle', () => {
    test.skip(FAMILY !== '' && FAMILY !== 'lifecycle', 'other family');

    test('locale, dir and text scale survive lock, unlock, reload and hidden then visible', async ({ page }) => {
        test.setTimeout(420_000);
        await watchRawKeys(page);
        await createWallet(page);
        await openLanguageWithDeveloperMode(page);
        await pickLanguage(page, 'pseudo-rtl');
        await expectLocale(page, 'pseudo-rtl', 'picked');
        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent('xchain:native-font-scale', { detail: { fontScale: 1.5 } }));
        });
        const rootFont = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
        await expect.poll(rootFont).toBeCloseTo(24, 1);

        // Hidden then visible.
        await page.evaluate(() => {
            for (const state of ['hidden', 'visible']) {
                Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
                document.dispatchEvent(new Event('visibilitychange'));
            }
        });
        await settle(page);
        await expectLocale(page, 'pseudo-rtl', 'hidden then visible');
        expect(await rootFont()).toBeCloseTo(24, 1);

        // Lock and unlock. At phone width Lock is the wallet menu header's
        // icon action (U98), not a shell control.
        await page.getByRole('button', { name: /^‏?⟦?Open menu⟧?$/ }).first().click();
        await page.getByRole('dialog').getByRole('button', { name: /^‏?⟦?Lock( wallet)?⟧?$/ }).first().click();
        const unlock = page.getByRole('button', { name: /Unlock Wallet/ });
        await expect(unlock).toBeVisible();
        await expectLocale(page, 'pseudo-rtl', 'lock screen');
        expect(await rootFont()).toBeCloseTo(24, 1);
        // Exact or by role: each field's 'About ...' help tip (U57) carries its label too.
        await page.getByRole('textbox', { name: /^‏?⟦?Password⟧?$/ }).fill(DEFAULT_PASSWORD);
        await unlock.click();
        await expect(unlockedAnyScreen(page).or(page.getByRole('region', { name: /App header/ })).first())
            .toBeVisible({ timeout: 120_000 }).catch(() => {});
        await expect(unlock).toBeHidden({ timeout: 120_000 });
        await expectLocale(page, 'pseudo-rtl', 'after unlock');
        expect(await rootFont()).toBeCloseTo(24, 1);

        // Reload: the lock screen paints the cached choice from the first frame.
        await page.reload();
        await expect(unlock.or(page.locator('main')).first()).toBeVisible({ timeout: 120_000 });
        await expectLocale(page, 'pseudo-rtl', 'after reload');
        if (await unlock.isVisible()) {
            await page.getByRole('textbox', { name: /^‏?⟦?Password⟧?$/ }).fill(DEFAULT_PASSWORD);
            await unlock.click();
            await expect(unlock).toBeHidden({ timeout: 120_000 });
            await expectLocale(page, 'pseudo-rtl', 'after reload and unlock');
        }
        const hits = await page.evaluate(() => window.__rawKeyHits);
        expect(hits, 'raw message keys painted during the reload').toEqual([]);
    });
});
