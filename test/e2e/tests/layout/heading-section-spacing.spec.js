// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Headings and section spacing hold one value per role on every screen.
// The page title, a section heading and a card title each take the size and
// weight of their type role token, and every section heading sits the section
// header gap above its content. Screens that wrap each group in a section
// stack those sections at the section gap, not at a local margin on top of it.
// The expected values are read from the tokens in the page, so a token change
// moves the test with the screens and a screen that stops using the token fails.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    openSettings,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const SIZES = [
    [360, 800],
    [1440, 900],
];

// Routes reached from the navigation, with the sections each one stacks.
const NAV_ROUTES = ['History', 'Marketplace', 'Contracts', 'Dispensers', 'Contacts', 'Lists', 'Payments due'];
// Marketplace has no bottom bar or More sheet entry at phone width.
const PHONE_SKIPS = new Set(['Marketplace']);

// Settings screens whose section headings or card titles are checked.
const SETTINGS_SECTIONS = ['Display', 'Connected sites', 'Automatic donation system', 'Keyboard'];

async function enterDemoWallet(page) {
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Try in demo mode' }).click();
    await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });
}

// The token values as the browser computes them: a probe element takes each
// value so var() chains resolve to pixels and weights.
function readTokens() {
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const font = (sizeToken, weightToken) => {
        probe.style.cssText = `font-size: var(${sizeToken}); font-weight: var(${weightToken}); position: absolute; visibility: hidden`;
        const cs = getComputedStyle(probe);
        return { size: cs.fontSize, weight: cs.fontWeight };
    };
    const length = (token) => {
        probe.style.cssText = `padding-top: var(${token}); position: absolute; visibility: hidden`;
        return parseFloat(getComputedStyle(probe).paddingTop);
    };
    const tokens = {
        pageTitle: font('--xc-type-page-title-size', '--xc-type-page-title-weight'),
        sectionTitle: font('--xc-type-section-title-size', '--xc-type-section-title-weight'),
        cardTitle: font('--xc-type-card-title-size', '--xc-type-card-title-weight'),
        sectionGap: length('--xc-section-gap'),
        sectionHeaderGap: length('--xc-section-header-gap'),
    };
    probe.remove();
    return tokens;
}

// What the visible screen shows: the page title, each section heading with
// the distance to its content, the gaps between stacked sections, and any
// bare headings that are not one of the shared section headers.
function readScreen() {
    const main = document.getElementById('xc-main');
    const visible = (el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width >= 1 && r.height >= 1;
    };
    const style = (el) => {
        const cs = getComputedStyle(el);
        return { size: cs.fontSize, weight: cs.fontWeight };
    };
    const titleEl = [...main.parentElement.querySelectorAll('header h1')].find(visible);
    const sections = [...main.querySelectorAll('[data-xc-section-header]')].filter(visible).map((wrap) => {
        const heading = wrap.querySelector('h2, h3, h4');
        const next = wrap.nextElementSibling;
        return {
            text: (heading.textContent || '').trim().slice(0, 40),
            ...style(heading),
            toContent: next && visible(next)
                ? Math.round((next.getBoundingClientRect().top - wrap.getBoundingClientRect().bottom) * 100) / 100
                : null,
        };
    });
    const stacked = [];
    for (const section of main.querySelectorAll('section')) {
        const next = section.nextElementSibling;
        // Only groups titled by their own h2: a chain group inside a section
        // is a nested block that the section's own layout spaces.
        const own = section.querySelector(':scope > [data-xc-section-header] h2');
        if (own && next && next.tagName === 'SECTION' && visible(section) && visible(next)) {
            stacked.push({
                text: (section.querySelector('h2, h3')?.textContent || '').trim().slice(0, 40),
                gap: Math.round((next.getBoundingClientRect().top - section.getBoundingClientRect().bottom) * 100) / 100,
            });
        }
    }
    return {
        title: titleEl ? { text: (titleEl.textContent || '').trim(), ...style(titleEl) } : null,
        sections,
        stacked,
        bare: [...main.querySelectorAll('h2, h3')].filter(visible)
            .filter((h) => !h.closest('[data-xc-section-header]'))
            .map((h) => ({ text: (h.textContent || '').trim().slice(0, 40), ...style(h) })),
    };
}

function expectScreen(name, screen, tokens, { stackedGap = true } = {}) {
    if (screen.title) {
        expect(screen.title, `${name}: page title`).toMatchObject(tokens.pageTitle);
    }
    for (const section of screen.sections) {
        expect(section, `${name}: section heading "${section.text}"`).toMatchObject(tokens.sectionTitle);
        if (section.toContent !== null) {
            expect(section.toContent, `${name}: gap under "${section.text}"`).toBe(tokens.sectionHeaderGap);
        }
    }
    for (const pair of stackedGap ? screen.stacked : []) {
        expect(pair.gap, `${name}: gap after the "${pair.text}" section`).toBe(tokens.sectionGap);
    }
}

for (const [width, height] of SIZES) {
    test(`headings and section gaps follow the tokens at ${width}x${height}`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width, height });
        await enterDemoWallet(page);
        const tokens = await page.evaluate(readTokens);
        expect(tokens.sectionHeaderGap, 'header gap is below the section gap').toBeLessThan(tokens.sectionGap);

        for (const route of NAV_ROUTES.filter((r) => width > 599 || !PHONE_SKIPS.has(r))) {
            try {
                await gotoSection(page, route);
            } catch {
                // Not every route is in the bottom bar's More sheet at phone width.
                continue;
            }
            await page.waitForTimeout(400);
            expectScreen(route, await page.evaluate(readScreen), tokens);
        }

        for (const section of SETTINGS_SECTIONS) {
            for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape');
            await gotoSection(page, 'Home');
            await openSettings(page);
            const row = page.getByRole('main').getByRole('button', { name: new RegExp(`^${section}\\b`) }).first();
            if (await row.count() === 0) continue;
            await row.click();
            await page.waitForTimeout(400);
            const screen = await page.evaluate(readScreen);
            // Settings tightens the section gap for its row lists, so only the
            // heading roles and the header gap are compared here.
            expectScreen(`Settings > ${section}`, screen, tokens, { stackedGap: false });
            // Per-network blocks and shortcut groups title themselves with the
            // card or section role, never a raw size.
            const role = section === 'Keyboard' ? tokens.sectionTitle : section === 'Automatic donation system' ? tokens.cardTitle : null;
            for (const chain of role ? screen.bare : []) {
                expect(chain, `Settings > ${section}: heading "${chain.text}"`).toMatchObject(role);
            }
        }
    });
}
