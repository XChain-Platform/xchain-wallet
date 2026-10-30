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

/** Runs in the page: computed style of every visible field. */
function readFields() {
    const out = [];
    document.activeElement?.blur?.();
    const sel = 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=file]), select, textarea';
    for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const cs = getComputedStyle(el);
        out.push({
            el: `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''}#${el.id || ''} "${(el.getAttribute('aria-label') || el.name || el.placeholder || '').slice(0, 30)}"`,
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            readOnly: !!el.readOnly,
            bg: cs.backgroundColor,
            border: cs.borderTopColor,
            borderWidth: cs.borderTopWidth,
            radius: cs.borderTopLeftRadius,
        });
    }
    return out;
}

const SUBPAGES = ['This wallet', 'Display', 'Privacy', 'Safety', 'Wallet mode', 'Backup', 'Fees', 'Connected sites',
    'Automatic donation system', 'Developer mode', 'About', 'Network & endpoints', 'Notifications', 'Keyboard'];

const escapeRegExp = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('dark mode fields share the field tokens', async ({ page }, testInfo) => {
    test.setTimeout(20 * 60 * 1000);
    const outDir = OUT_ROOT ? join(OUT_ROOT, testInfo.project.name) : testInfo.outputPath('fields');
    mkdirSync(outDir, { recursive: true });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    const screens = {};
    const snap = async (label) => {
        await page.mouse.move(1, 1);
        await page.waitForTimeout(400);
        screens[label] = await page.evaluate(readFields);
        await page.screenshot({ path: join(outDir, `${label.replace(/[^a-z0-9]+/gi, '-')}.png`) });
    };

    await gotoSection(page, 'Settings');
    await snap('settings-root');
    for (const title of SUBPAGES) {
        try {
            const row = page.getByRole('main').getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}\\b`, 'i') }).first();
            if (!(await row.isVisible().catch(() => false))) continue;
            await row.click();
            await snap(`settings-${title}`);
            await page.getByRole('button', { name: 'Back to settings' }).click();
        } catch (err) { screens[`settings-${title}`] = [{ error: String(err.message).slice(0, 120) }]; }
    }

    // Developer mode adds the Network & endpoints page.
    try {
        await gotoSection(page, 'Settings');
        await page.getByRole('main').getByRole('button', { name: /^Developer mode/ }).click();
        const dev = page.getByRole('switch', { name: 'Turn on developer mode', exact: true });
        if (!(await dev.isChecked())) await dev.click();
        await snap('settings-Developer mode on');
        await page.getByRole('button', { name: 'Back to settings' }).click();
        await page.getByRole('main').getByRole('button', { name: /^Network & endpoints/i }).first().click();
        await snap('settings-Network & endpoints');
    } catch (err) { screens['settings-dev'] = [{ error: String(err.message).slice(0, 120) }]; }

    const palette = async (title) => {
        await page.keyboard.press('ControlOrMeta+k');
        const dialog = page.getByRole('dialog', { name: 'Command palette' });
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        await dialog.getByRole('combobox').first().fill(title);
        await page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
        await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
    };
    for (const name of ['Send', 'Receive', 'Issue token', 'Create dispenser']) {
        try {
            if (name === 'Send' || name === 'Receive') await gotoSection(page, name);
            else await palette(name);
            await snap(`page-${name}`);
        } catch (err) { screens[`page-${name}`] = [{ error: String(err.message).slice(0, 120) }]; }
    }
    try {
        await gotoSection(page, 'Contacts');
        await page.getByRole('button', { name: /^(Add contact|Create first contact)$/ }).click();
        await snap('page-New contact');
    } catch (err) { screens['page-New contact'] = [{ error: String(err.message).slice(0, 120) }]; }

    writeFileSync(join(outDir, 'fields.json'), JSON.stringify(screens, null, 2));

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
    const mismatches = [];
    for (const state of [false, true]) {
        const expected = await expectedFor(state);
        const all = Object.entries(screens).flatMap(([label, fs]) => fs.filter((f) => !f.error && f.disabled === state && !f.readOnly)
            .map((f) => ({ label, ...f })));
        for (const f of all) if (key(f) !== expected) mismatches.push(`${state ? 'disabled' : 'enabled'} ${f.label} ${f.el}: ${key(f)} (expected ${expected})`);
    }
    expect(mismatches, mismatches.join('\n')).toEqual([]);
});
