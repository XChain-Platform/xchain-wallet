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

function languageSelect(page) {
    return page.getByRole('combobox', { name: /^‏?⟦?Language⟧?$/ });
}

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function openLanguageWithDeveloperMode(page) {
    await gotoSection(page, 'Settings');
    await page.getByRole('main').getByRole('button', { name: /^Developer mode/ }).click();
    const developerMode = page.getByRole('switch', { name: 'Turn on developer mode', exact: true });
    if (!(await developerMode.isChecked())) {
        await developerMode.click();
        await expect(developerMode).toBeChecked();
    }
    await page.getByRole('button', { name: 'Back to settings' }).click();
    await expect(languageSelect(page)).toBeVisible();
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
        const select = languageSelect(page);

        // First pass: the pseudo chunk is still cold, so the middle pick is async.
        const started = Date.now();
        await select.evaluate((el) => {
            for (const value of ['en', 'pseudo-rtl', 'en']) {
                el.value = value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        expect(Date.now() - started).toBeLessThan(100);
        await settle(page);
        await page.waitForLoadState('networkidle');
        let s = await expectLocale(page, 'en', 'cold chunk race');

        // Warm the chunk, then race again with every pick synchronous.
        await select.selectOption('pseudo-rtl');
        await expectLocale(page, 'pseudo-rtl', 'warm pick');
        await languageSelect(page).evaluate((el) => {
            for (const value of ['en', 'pseudo-rtl', 'en']) {
                el.value = value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        s = await expectLocale(page, 'en', 'warm chunk race');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('en');

        // Ending on the RTL pick instead.
        await languageSelect(page).evaluate((el) => {
            for (const value of ['pseudo-rtl', 'en', 'pseudo-rtl']) {
                el.value = value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await expectLocale(page, 'pseudo-rtl', 'race ending on RTL');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('pseudo-rtl');
        await expect(languageSelect(page)).toHaveValue('pseudo-rtl');

        await reloadAndOpen(page);
        s = await expectLocale(page, 'pseudo-rtl', 'after reload');
        expect(s.cached).toBe('pseudo-rtl');
    });

    test('double-click and repeat picks of one language keep it', async ({ page }) => {
        test.setTimeout(240_000);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await openLanguageWithDeveloperMode(page);
        const select = languageSelect(page);
        await select.dblclick();
        await page.keyboard.press('Escape');
        await select.selectOption('pseudo-rtl');
        await languageSelect(page).selectOption('pseudo-rtl');
        await languageSelect(page).evaluate((el) => {
            for (let i = 0; i < 5; i += 1) {
                el.value = 'pseudo-rtl';
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await expectLocale(page, 'pseudo-rtl', 'repeat RTL picks');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('pseudo-rtl');
        await languageSelect(page).dblclick();
        await page.keyboard.press('Escape');
        await languageSelect(page).selectOption('en');
        await languageSelect(page).selectOption('en');
        await expectLocale(page, 'en', 'repeat English picks');
        await expect.poll(async () => (await snapshot(page)).cached).toBe('en');
        await expect(languageSelect(page)).toHaveValue('en');
    });

    test('two tabs of one context end on the last pick', async ({ page, context }) => {
        test.setTimeout(300_000);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await openLanguageWithDeveloperMode(page);
        await languageSelect(page).selectOption('pseudo-rtl');
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
        await languageSelect(page).selectOption('en');
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
        await languageSelect(page).selectOption('pseudo-rtl');
        await expect.poll(() => requests).toBeGreaterThan(0);
        await settle(page);
        await expectLocale(page, 'en', 'after 404');
        await expect(languageSelect(page)).toHaveValue('en');
        expect((await snapshot(page)).cached).toBe('en');

        block = false;
        const before = requests;
        await languageSelect(page).selectOption('pseudo-rtl');
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

        // Slow chunk, then English before it lands: English must stay.
        await languageSelect(page).selectOption('pseudo-rtl');
        await expect.poll(() => delayed).toBeGreaterThan(0);
        await expectLocale(page, 'en', 'while the chunk is delayed');
        await languageSelect(page).selectOption('en');
        await page.waitForLoadState('networkidle');
        await expect.poll(() => page.evaluate(() => document.documentElement.dir), { timeout: 20_000 }).toBe('ltr');
        await expectLocale(page, 'en', 'after the delayed chunk lands behind a newer pick');
        expect((await snapshot(page)).cached).toBe('en');

        // Slow chunk with no newer pick: it applies when it lands.
        await languageSelect(page).selectOption('pseudo-rtl');
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
        await languageSelect(page).selectOption('pseudo-rtl');
        await settle(page);
        await expectLocale(page, 'en', 'offline pick');
        await expect(languageSelect(page)).toHaveValue('en');

        await context.setOffline(false);
        offline = false;
        const before = requests;
        await languageSelect(page).selectOption('pseudo-rtl');
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
        await languageSelect(page).selectOption('pseudo-rtl');
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

        // Lock and unlock.
        await page.getByRole('button', { name: /^‏?⟦?Lock( wallet)?⟧?$/ }).first().click();
        const unlock = page.getByRole('button', { name: /Unlock Wallet/ });
        await expect(unlock).toBeVisible();
        await expectLocale(page, 'pseudo-rtl', 'lock screen');
        expect(await rootFont()).toBeCloseTo(24, 1);
        await page.getByLabel(/^‏?⟦?Password⟧?$/).fill(DEFAULT_PASSWORD);
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
            await page.getByLabel(/^‏?⟦?Password⟧?$/).fill(DEFAULT_PASSWORD);
            await unlock.click();
            await expect(unlock).toBeHidden({ timeout: 120_000 });
            await expectLocale(page, 'pseudo-rtl', 'after reload and unlock');
        }
        const hits = await page.evaluate(() => window.__rawKeyHits);
        expect(hits, 'raw message keys painted during the reload').toEqual([]);
    });
});
