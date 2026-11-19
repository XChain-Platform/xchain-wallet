// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every enabled text field, select and textarea in dark mode shares one fill,
// border colour and radius; disabled fields share the disabled tokens. The
// walk covers each Settings page and the main forms in the demo wallet.
// Computed styles are written to FIELD_OUT/<project>/fields.json for a person
// to read; the test fails on any mismatch.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dismissIntroCarousel, expect, gotoSection, test, unlockedShell } from '../fixtures/wallet.js';
import { enterDemoWallet } from '../fixtures/responsive.js';

// FIELD_OUT=<dir> keeps the fields and screenshots; by default they go to
// the test's own output directory.
const OUT_ROOT = process.env.FIELD_OUT || '';

// The big amounts on the Quick Give/Get cards (G31) are borderless and
// transparent by operator sign-off (fe2bc59bb); the card's own 1px border
// frames each one. As in form-fields-visible-borders.spec.js (bc5edd3fe), a
// field stands in on its card only while it draws no border or shadow of its
// own and the card draws a border on every side. Create dispenser names its
// cards per fill. CARD_FRAMED pins the exemption to those two amounts, so any
// other field that loses its tokens (the Escrow amount in the same card
// included) still fails.
const GIVE_GET_CARDS = ['You give', 'You get', 'You give per fill', 'You get per fill'];
const CARD_FRAMED = {
    'page-Create dispenser': ['You get per fill: Trigger price (BTC)', 'You give per fill: Give amount per fill'],
};

/** Runs in the page: computed style of every visible field. */
function readFields(cardNames) {
    const out = [];
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const shadowIsVisible = (value) => value !== 'none'
        && value.split(/,(?![^()]*\))/).some((layer) => !/\btransparent\b/i.test(layer)
            && !/rgba\([^)]*,\s*0\)/i.test(layer));
    document.activeElement?.blur?.();
    const sel = 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=file]), select, textarea';
    for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const cs = getComputedStyle(el);
        const selfOutlined = sides.some((side) => parseFloat(cs[`border${side}Width`]) >= 1)
            || shadowIsVisible(cs.boxShadow);
        const card = el.closest(cardNames.map((name) => `section[aria-label="${name}"]`).join(', '));
        const cardStyle = card ? getComputedStyle(card) : null;
        const cardFramed = !selfOutlined && Boolean(cardStyle)
            && sides.every((side) => parseFloat(cardStyle[`border${side}Width`]) >= 1
                && cardStyle[`border${side}Style`] !== 'none');
        out.push({
            el: `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''}#${el.id || ''} "${(el.getAttribute('aria-label') || el.name || el.placeholder || '').slice(0, 30)}"`,
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            readOnly: !!el.readOnly,
            bg: cs.backgroundColor,
            border: cs.borderTopColor,
            borderWidth: cs.borderTopWidth,
            radius: cs.borderTopLeftRadius,
            framedBy: cardFramed ? `${card.getAttribute('aria-label')}: ${el.getAttribute('aria-label') || ''}` : undefined,
        });
    }
    return out;
}

// The Settings index lists groups; each opens a page of rows.
const SUBPAGES = ['Wallets', 'Security', 'Backup and Recovery', 'Privacy and Sites', 'Appearance', 'Notifications',
    'Network and Fees', 'Advanced'];

const escapeRegExp = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('dark mode fields share the field tokens', async ({ page }, testInfo) => {
    test.setTimeout(20 * 60 * 1000);
    const outDir = OUT_ROOT ? join(OUT_ROOT, testInfo.project.name) : testInfo.outputPath('fields');
    mkdirSync(outDir, { recursive: true });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    // Each walk step is bounded, so a stale label fails that step in seconds
    // (and the test below) instead of waiting out the whole test timeout.
    page.setDefaultTimeout(30_000);
    const screens = {};
    const snap = async (label) => {
        await page.mouse.move(1, 1);
        await page.waitForTimeout(400);
        screens[label] = await page.evaluate(readFields, GIVE_GET_CARDS);
        await page.screenshot({ path: join(outDir, `${label.replace(/[^a-z0-9]+/gi, '-')}.png`) });
    };

    await gotoSection(page, 'Settings');
    await snap('settings-root');
    const skipped = [];
    for (const title of SUBPAGES) {
        try {
            // The drill row's visible text starts with its title (run into
            // its summary, so no word boundary there). Matching the accessible
            // name alone also hits the inline rows' help tips ("About the
            // language setting" for About), which carry no text and open no page.
            const row = page.getByRole('main').getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}\\b`, 'i') })
                .filter({ hasText: new RegExp(`^${escapeRegExp(title)}`, 'i') }).first();
            if (!(await row.isVisible().catch(() => false))) { skipped.push(title); continue; }
            await row.click();
            await snap(`settings-${title}`);
            await page.getByRole('button', { name: 'Back to settings' }).click();
        } catch (err) { screens[`settings-${title}`] = [{ error: String(err.message).slice(0, 120) }]; }
    }

    // Developer mode adds the Network & endpoints page.
    try {
        await gotoSection(page, 'Settings');
        await page.getByRole('main').getByRole('button', { name: /^Advanced\b/ }).click();
        const dev = page.getByRole('switch', { name: 'Developer mode', exact: true });
        if (!(await dev.isChecked())) {
            await dev.click();
            await expect(dev).toBeChecked();
        }
        await snap('settings-Developer mode on');
        // Back once: the switch lives on the Advanced group page.
        const back = page.getByRole('button', { name: 'Back to settings', exact: true }).filter({ visible: true }).first();
        await back.click();
        await page.getByRole('main').getByRole('button', { name: /^Network and Fees\b/ }).click();
        await page.getByRole('main').getByRole('button', { name: /^Network endpoints\b/i }).first().click();
        await snap('settings-Network & endpoints');
    } catch (err) { screens['settings-dev'] = [{ error: String(err.message).slice(0, 120) }]; }

    const palette = async (title) => {
        await page.keyboard.press('ControlOrMeta+k');
        const dialog = page.getByRole('dialog', { name: 'Wallet menu' });
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        await dialog.getByRole('combobox').first().fill(title);
        await page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
        await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
    };
    for (const name of ['Send', 'Receive', 'Issue Token', 'Create dispenser']) {
        try {
            if (name === 'Send' || name === 'Receive') await gotoSection(page, name);
            else await palette(name);
            // Issue Token opens the token wizard straight on its Issue form,
            // with the template as a dropdown on that form.
            if (name === 'Issue Token') {
                await page.getByRole('form', { name: 'Issue Token', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
            }
            await snap(`page-${name}`);
        } catch (err) { screens[`page-${name}`] = [{ error: String(err.message).slice(0, 120) }]; }
    }
    try {
        await gotoSection(page, 'Contacts');
        await page.getByRole('button', { name: /^(Add contact|Create first contact)$/ }).click();
        await snap('page-New contact');
    } catch (err) { screens['page-New contact'] = [{ error: String(err.message).slice(0, 120) }]; }

    writeFileSync(join(outDir, 'fields.json'), JSON.stringify(screens, null, 2));

    // A step that could not reach its screen measured nothing there.
    const stepErrors = Object.entries(screens).filter(([, fs]) => fs.some((f) => f.error))
        .map(([label, fs]) => `${label}: ${fs.find((f) => f.error).error}`);
    expect(stepErrors, stepErrors.join('\n')).toEqual([]);
    // Notifications sits inline on the Settings root (measured there), and
    // Network & endpoints shows only with developer mode (walked above), and
    // the phone layout has no Keyboard page; any other row the walk cannot
    // find is a stale title.
    const mayBeAbsent = ['Notifications', 'Network & endpoints', ...(testInfo.project.use.isMobile ? ['Keyboard'] : [])];
    expect(skipped.filter((title) => !mayBeAbsent.includes(title)), 'Settings rows the walk did not find').toEqual([]);

    // The shared tokens, resolved in the page the way a field resolves them:
    // enabled fields sit on --xc-surface, disabled ones on the disabled tokens.
    const expectedFor = (disabled) => page.evaluate((d) => {
        const probe = document.createElement('div');
        probe.style.cssText = d
            ? 'background:var(--xc-control-disabled-bg);border:1px solid var(--xc-control-disabled-border);border-radius:var(--xc-control-radius)'
            : 'background:var(--xc-surface);border:1px solid var(--xc-control-border);border-radius:var(--xc-control-radius)';
        document.body.appendChild(probe);
        const cs = getComputedStyle(probe);
        const r = `${cs.backgroundColor}|${cs.borderTopColor}|${cs.borderTopLeftRadius}`;
        probe.remove();
        return r;
    }, disabled);
    const key = (f) => `${f.bg}|${f.border}|${f.radius}`;
    const framed = Object.fromEntries(Object.entries(screens)
        .map(([label, fs]) => [label, fs.filter((f) => f.framedBy).map((f) => f.framedBy).sort()])
        .filter(([, list]) => list.length));
    expect(framed, 'fields framed by a Give/Get card instead of their own field tokens').toEqual(CARD_FRAMED);
    const mismatches = [];
    for (const state of [false, true]) {
        const expected = await expectedFor(state);
        const all = Object.entries(screens).flatMap(([label, fs]) => fs.filter((f) => !f.error && f.disabled === state && !f.readOnly && !f.framedBy)
            .map((f) => ({ label, ...f })));
        for (const f of all) if (key(f) !== expected) mismatches.push(`${state ? 'disabled' : 'enabled'} ${f.label} ${f.el}: ${key(f)} (expected ${expected})`);
    }
    expect(mismatches, mismatches.join('\n')).toEqual([]);
});
