// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every form and button looks the same: walk each form route reachable from
// the command palette and Settings at a phone and a desktop size and measure
//   - every text, number, select and textarea field draws a solid 1px border
//     in the shared control-border colour (on itself or on its wrapper),
//   - inputs, selects and buttons that share a row share one height,
//   - Paste and Max sit inside the field they act on,
//   - primary, secondary and danger buttons keep the shared Button colours
//     (secondary keeps its 1px outline) and a button drawn like one is a Button,
//   - disabled buttons use the shared disabled colours,
//   - a label sits above its field, one label-gap token away.

import { writeFileSync } from 'node:fs';
import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    openSettings,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { width: 360, height: 800 },
    { width: 1440, height: 900 },
];

/** Palette destinations that open a form (or a form-bearing list). */
const PALETTE_ROUTES = [
    'Issue a token directly', 'Add to an existing token', 'Burn supply', 'Move balances, ownerships',
    'Post a message on-chain', 'Price a token in a currency', 'Sell a token at a fixed rate',
    'Distribute to holders', 'Send to many recipients', 'Publish an address or token list',
    'Public or token-gated on-chain file', 'Route this address', 'Send a token to another chain',
    'Choose which chains a token', 'Author any action by hand', 'Trade one token for another',
    'Trade at the price you set', 'Settle a matched order', 'Swap across chains',
    'Limit order across chains', 'Check a signed message',
    'Guided issuance wizard', 'Your saved addresses', 'Manage your addresses', 'Your staking positions',
    'Polls and voting', 'Browse betting markets', 'Smart contracts', 'Encrypted inbox', 'Markets and orders',
    'Address and token lists', 'Coin payments you still owe', 'Find open dispensers',
];

const SETTINGS_SECTIONS = [
    'This wallet', 'Accounts & addresses', 'Display', 'Keyboard', 'Privacy', 'Safety', 'Wallet mode',
    'Backup', 'Fees', 'Network & endpoints', 'Connected sites', 'Automatic donation system', 'Developer', 'About',
];

async function palette(page, destination) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill(destination);
    const option = dialog.getByRole('option').filter({ hasText: destination }).first();
    if (await option.count() === 0) {
        await page.keyboard.press('Escape');
        return false;
    }
    await option.click();
    await expect(dialog).toBeHidden();
    return true;
}

async function settle(page) {
    // A focused field draws the focus ring colour, not its resting border.
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' }).catch(() => {});
    await page.evaluate(() => document.activeElement?.blur?.());
    // A hovered control draws its hover border.
    await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await page.waitForTimeout(350);
}

/**
 * Runs in the page. Returns one string per fault on the current screen and
 * how many of each control it measured.
 */
function formFaults() {
    const root = document.documentElement;
    const resolve = (property, token) => {
        const probe = document.createElement('div');
        probe.style.cssText = `position:fixed;left:-99px;top:0;${property}:var(${token})`;
        if (property.startsWith('border')) probe.style.cssText += ';border-style:solid;border-width:1px';
        document.body.append(probe);
        const value = getComputedStyle(probe).getPropertyValue(property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
        probe.remove();
        return value;
    };
    const borderToken = resolve('border-color', '--xc-control-border');
    const strongBorder = resolve('border-color', '--xc-border-strong');
    const accent = resolve('background-color', '--xc-accent-primary');
    const danger = resolve('background-color', '--xc-danger');
    const disabledBg = resolve('background-color', '--xc-control-disabled-bg');
    const disabledBorder = resolve('border-color', '--xc-control-disabled-border');
    const disabledText = resolve('color', '--xc-control-disabled-text');
    const controlRadius = resolve('border-radius', '--xc-control-radius');
    const controlSizes = ['sm', 'md', 'lg'].map((n) => ({
        height: resolve('height', `--xc-control-h-${n}`),
        font: resolve('font-size', `--xc-control-font-${n}`),
    }));
    const labelGap = parseFloat(getComputedStyle(root).getPropertyValue('--xc-label-gap')) || 4;
    const labelGapPx = (() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:-99px;margin-top:var(--xc-label-gap)';
        document.body.append(probe);
        const px = parseFloat(getComputedStyle(probe).marginTop);
        probe.remove();
        return Number.isFinite(px) ? px : labelGap;
    })();

    const overlay = '[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"], [role="tooltip"]';
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'
            && cs.opacity !== '0' && !el.closest(overlay) && !el.closest('[aria-hidden="true"]');
    };
    const name = (el) => {
        const text = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 28);
        const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '';
        return `${el.tagName.toLowerCase()} "${text || label}"`;
    };
    const rect = (el) => el.getBoundingClientRect();
    const contains = (outer, inner) => outer.left - 1 <= inner.left && outer.right + 1 >= inner.right
        && outer.top - 1 <= inner.top && outer.bottom + 1 >= inner.bottom;
    const borderOf = (el) => {
        const cs = getComputedStyle(el);
        const sides = ['Top', 'Right', 'Bottom', 'Left'];
        return sides.every((s) => cs[`border${s}Style`] === 'solid' && cs[`border${s}Width`] === '1px'
            && cs[`border${s}Color`] === borderToken);
    };
    const sharedClass = (el, part) => [...el.classList].some((c) => new RegExp(`(^|_)${part}(_|$)`).test(c));

    // A TokenField trigger is a field, not a button.
    const tokenTrigger = (el) => el.tagName === 'BUTTON' && sharedClass(el, 'control') && el.querySelector('[class*="caret"]');
    const inFieldSizes = [];
    const styles = { labels: [], fields: [] };
    const faults = [];
    const counts = { fields: 0, buttons: 0, rows: 0, labels: 0, pasteMax: 0, disabled: 0 };

    // Fields, and the box that draws each one's border (itself or a wrapper).
    const fieldSel = 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=file]):not([type=color]):not([type=button]):not([type=submit]), select, textarea';
    const fields = [...document.querySelectorAll(fieldSel), ...[...document.querySelectorAll('button')].filter(tokenTrigger)].filter(visible);
    const boxOf = (el) => {
        if (borderOf(el)) return el;
        for (let a = el.parentElement, depth = 0; a && depth < 3; a = a.parentElement, depth += 1) {
            // A field's own wrapper is about its size; a card around it is not.
            if (borderOf(a) && contains(rect(a), rect(el)) && rect(a).height <= rect(el).height + 16) return a;
        }
        return null;
    };
    const boxes = new Map();
    for (const el of fields) {
        counts.fields += 1;
        const box = boxOf(el);
        boxes.set(el, box || el);
        {
            const fcs = getComputedStyle(el);
            const bcs = getComputedStyle(box || el);
            styles.fields.push({ el: name(el), radius: bcs.borderTopLeftRadius, fontSize: fcs.fontSize, tag: el.tagName.toLowerCase() });
            if (bcs.borderTopLeftRadius !== controlRadius) faults.push(`field ${name(el)}: radius ${bcs.borderTopLeftRadius}, token ${controlRadius}`);
            if (!controlSizes.some((c) => c.font === fcs.fontSize)) faults.push(`field ${name(el)}: font size ${fcs.fontSize} is not a control size`);
            if (el.tagName !== 'TEXTAREA' && !el.readOnly && !controlSizes.some((c) => Math.abs(parseFloat(c.height) - rect(box || el).height) < 1)) {
                faults.push(`field ${name(el)}: height ${rect(box || el).height.toFixed(1)}px is not a control height`);
            }
        }
        if (el.disabled || (el.tagName === 'BUTTON' && el.matches(':disabled'))) {
            const dcs = getComputedStyle(el);
            if (dcs.backgroundColor !== disabledBg || dcs.borderTopColor !== disabledBorder || dcs.color !== disabledText) {
                faults.push(`field ${name(el)}: disabled look bg ${dcs.backgroundColor} border ${dcs.borderTopColor} text ${dcs.color}`);
            }
        }
        // A focused field (an autofocused first field) draws its focus ring instead.
        if (!box && el !== document.activeElement) {
            const cs = getComputedStyle(el);
            faults.push(`field ${name(el)}: border ${cs.borderTopStyle} ${cs.borderTopWidth} ${cs.borderTopColor}, token ${borderToken}`);
        }
    }

    // A switch or checkbox draws its own track or box over a transparent native input;
    // a native box showing through (a disabled one, say) is a second control.
    for (const el of document.querySelectorAll('input[type=checkbox], input[type=radio]')) {
        const r = rect(el);
        if (!visible(el) && r.width <= 1) continue;
        const cs = getComputedStyle(el);
        if (cs.position === 'absolute' && r.width >= 30 && cs.opacity !== '0') faults.push(`${name(el)}: native input shows through its custom control`);
    }

    // Paste and Max sit inside the field they act on.
    // Page-header actions and the shared notice's own action are measured by
    // their own specs.
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter((el) => visible(el)
        && !el.closest('header, [data-variant]') && !tokenTrigger(el));
    for (const btn of buttons) {
        const label = (btn.getAttribute('aria-label') || btn.innerText || '').trim();
        if (!/^(paste|max|use max)\b/i.test(label)) continue;
        counts.pasteMax += 1;
        const r = rect(btn);
        const inside = [...boxes.values()].some((box) => box !== btn && contains(rect(box), r));
        if (!inside) faults.push(`${name(btn)}: sits outside any field`);
        const box = [...boxes.values()].find((b) => b !== btn && contains(rect(b), r));
        if (box) {
            const cs = getComputedStyle(btn);
            inFieldSizes.push({ el: name(btn), height: Math.round(r.height * 10) / 10, fontSize: cs.fontSize, inset: Math.round((r.top - rect(box).top) * 10) / 10 });
        }
    }

    // Row heights: fields, selects and text buttons that share a row.
    const rowItems = [];
    for (const el of fields) {
        if (el.tagName === 'TEXTAREA') continue;
        rowItems.push({ el, box: boxes.get(el), r: rect(boxes.get(el)) });
    }
    for (const btn of buttons) {
        if (btn.closest('[role="tablist"], [role="menu"], nav')) continue;
        // A one-character button (the "?" help tip) is an icon, not a text button.
        if ((btn.innerText || '').trim().length < 2) continue;
        if (sharedClass(btn, 'link') || btn.closest('li')) continue;
        if ([...boxes.values()].some((box) => box !== btn && contains(rect(box), rect(btn)))) continue;
        rowItems.push({ el: btn, box: btn, r: rect(btn) });
    }
    const sharesRowContainer = (a, b) => {
        const up = new Set();
        for (let n = a.parentElement; n; n = n.parentElement) up.add(n);
        let c = b.parentElement;
        while (c && !up.has(c)) c = c.parentElement;
        if (!c || c === document.body) return false;
        const cs = getComputedStyle(c);
        return cs.display === 'grid' || (cs.display.includes('flex') && !cs.flexDirection.startsWith('column'));
    };
    const seenRows = new Set();
    for (let i = 0; i < rowItems.length; i += 1) {
        const group = [rowItems[i]];
        for (let j = 0; j < rowItems.length; j += 1) {
            if (i === j) continue;
            const a = rowItems[i].r;
            const b = rowItems[j].r;
            const separate = a.right <= b.left + 1 || b.right <= a.left + 1;
            const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (separate && overlap >= Math.min(a.height, b.height) * 0.6
                && sharesRowContainer(rowItems[i].el, rowItems[j].el)) group.push(rowItems[j]);
        }
        if (group.length < 2) continue;
        const hs = group.map((g) => g.r.height);
        if (Math.max(...hs) - Math.min(...hs) <= 1.5) continue;
        const key = group.map((g) => name(g.el)).sort().join('|');
        if (seenRows.has(key)) continue;
        seenRows.add(key);
        counts.rows += 1;
        faults.push(`row heights differ: ${group.map((g) => `${name(g.el)} ${g.r.height.toFixed(1)}`).join(', ')}`);
    }

    // Buttons: shared variants and disabled look.
    for (const btn of buttons) {
        if (btn.tagName !== 'BUTTON') continue;
        if ([...boxes.values()].some((box) => box !== btn && contains(rect(box), rect(btn)))) continue;
        const cs = getComputedStyle(btn);
        const isShared = sharedClass(btn, 'btn');
        const text = (btn.innerText || '').trim();
        if (isShared) {
            counts.buttons += 1;
            if (btn.disabled && !sharedClass(btn, 'link')) {
                counts.disabled += 1;
                if (cs.backgroundColor !== disabledBg || cs.borderTopColor !== disabledBorder || cs.color !== disabledText) {
                    faults.push(`${name(btn)}: disabled look bg ${cs.backgroundColor} border ${cs.borderTopColor} text ${cs.color}`);
                }
                continue;
            }
            if (sharedClass(btn, 'secondary')) {
                if (cs.borderTopWidth !== '1px' || cs.borderTopStyle !== 'solid' || cs.borderTopColor !== strongBorder) {
                    faults.push(`${name(btn)}: secondary outline ${cs.borderTopStyle} ${cs.borderTopWidth} ${cs.borderTopColor}`);
                }
            }
            // The asset and market pickers draw a Button as a card (a design call).
            const asCard = sharedClass(btn, 'assetCard') || sharedClass(btn, 'marketSelector');
            if (sharedClass(btn, 'primary') && !asCard && cs.backgroundColor !== accent) {
                faults.push(`${name(btn)}: primary fill ${cs.backgroundColor}, token ${accent}`);
            }
            if (sharedClass(btn, 'danger') && cs.backgroundColor !== danger) {
                faults.push(`${name(btn)}: danger fill ${cs.backgroundColor}, token ${danger}`);
            }
            continue;
        }
        // A local button drawn like a Button (filled or outlined, with a
        // label) bypasses the shared variants.
        if (btn.closest('[role="tablist"], [role="menu"], [role="listbox"], nav, [role="radiogroup"]')) continue;
        if (btn.matches('[role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [aria-pressed], [aria-haspopup]')) continue;
        if (!text || rect(btn).height < 24 || rect(btn).height > 64 || sharedClass(btn, 'row')) continue;
        const bordered = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && cs.borderTopColor !== 'rgba(0, 0, 0, 0)';
        const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
        if (bordered || filled) faults.push(`${name(btn)}: local button style (not the shared Button), class ${[...btn.classList].join('.').slice(0, 60)}`);
    }

    // Labels sit above their field, one label-gap away.
    for (const el of fields) {
        const label = el.labels?.[0];
        if (!label || !visible(label)) continue;
        if (label.contains(el) && label.children.length > 1 && label.querySelector('input[type=checkbox]')) continue;
        counts.labels += 1;
        if (/:\s*$/.test((label.innerText || '').trim())) faults.push(`label "${(label.innerText || '').trim().slice(0, 24)}" ends with a colon`);
        {
            const lcs = getComputedStyle(label);
            styles.labels.push({ el: `label "${(label.innerText || '').trim().slice(0, 24)}"`, fontSize: lcs.fontSize, fontWeight: lcs.fontWeight, color: lcs.color });
        }
        const lr = rect(label);
        const fr = rect(boxes.get(el));
        // A settings row puts its help text between the label and the control.
        const next = label.nextElementSibling;
        if (next && next !== boxes.get(el) && !next.contains(el)) continue;
        if (lr.bottom <= fr.top + 1 === false && fr.left >= lr.right - 1) continue;
        if (label.contains(boxes.get(el))) {
            // A label wrapping its field: measure its own text node box.
            continue;
        }
        const gap = fr.top - lr.bottom;
        if (lr.bottom > fr.top + 1 && !(lr.right <= fr.left + 1)) faults.push(`label "${(label.innerText || '').trim().slice(0, 24)}" is not above ${name(el)}`);
        else if (lr.bottom <= fr.top + 1 && Math.abs(gap - labelGapPx) > 1.5) {
            faults.push(`label "${(label.innerText || '').trim().slice(0, 24)}" gap ${gap.toFixed(1)}px, token ${labelGapPx}px (${name(el)})`);
        }
    }
    return { faults, counts, inFieldSizes, styles };
}

async function walk(page, size, out) {
    const results = [];
    const record = async (label) => {
        await settle(page);
        const r = await page.evaluate(formFaults);
        results.push({ route: label, ...r });
        if (out) await page.screenshot({ path: `${out}/${size}-${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.png` }).catch(() => {});
    };
    for (const dest of PALETTE_ROUTES) {
        for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape').catch(() => {});
        if (!(await palette(page, dest))) { results.push({ route: dest, skipped: true, faults: [], counts: {} }); continue; }
        await record(dest);
    }
    // Screens reached from the navigation rather than the palette, and the
    // forms their add buttons open.
    for (const section of ['Send', 'Receive', 'DEX', 'Messaging']) {
        await gotoSection(page, section);
        await record(section);
    }
    for (const [dest, add] of [['Your saved addresses', 'Add contact'], ['Manage your addresses', 'Add or import address']]) {
        await palette(page, dest);
        const button = page.getByRole('button', { name: add, exact: true }).first();
        if (await button.count() === 0) continue;
        await button.click();
        await record(`${dest}: ${add}`);
    }
    for (const section of SETTINGS_SECTIONS) {
        for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape').catch(() => {});
        await openSettings(page);
        const back = page.getByRole('button', { name: 'Back to settings' }).filter({ visible: true }).first();
        if (await back.count()) await back.click();
        const row = page.getByRole('main').getByRole('button', { name: new RegExp(`^${section.replace(/[&]/g, '\\$&')}`) }).first();
        await row.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
        if (await row.count() === 0) { results.push({ route: `Settings ${section}`, skipped: true, faults: [], counts: {} }); continue; }
        await row.click();
        await record(`Settings ${section}`);
        // Every inline form the section opens.
        const openers = await page.getByRole('main').getByRole('button', { name: /…$/ }).evaluateAll((els) => els.map((e) => e.innerText.trim()));
        for (const opener of openers) {
            if (/remove|delete|reset|wipe/i.test(opener) && false) continue;
            const btn = page.getByRole('main').getByRole('button', { name: opener, exact: true }).first();
            if (await btn.count() === 0) continue;
            await btn.click().catch(() => {});
            await record(`Settings ${section} ${opener}`);
            const cancel = page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).first();
            if (await cancel.count()) await cancel.click().catch(() => {});
        }
    }
    return results;
}

for (const viewport of VIEWPORTS) {
    test(`forms and buttons are consistent at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.setTimeout(20 * 60 * 1000);
        await page.setViewportSize(viewport);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        const size = `${viewport.width}x${viewport.height}`;
        const results = await walk(page, size, process.env.FORM_SWEEP_OUT);
        if (process.env.FORM_SWEEP_OUT) writeFileSync(`${process.env.FORM_SWEEP_OUT}/${size}.json`, JSON.stringify(results, null, 1));
        const measured = results.reduce((n, r) => n + (r.counts.fields || 0), 0);
        expect(measured, 'the walk measured fields').toBeGreaterThan(10);
        // Every Paste and Max button inside a field is one height, set in from the border the same way.
        const inField = results.flatMap((r) => (r.inFieldSizes || []).map((b) => ({ route: r.route, ...b })));
        for (const key of ['height', 'inset']) {
            const values = [...new Set(inField.map((b) => b[key]))];
            expect(values.length, `in-field Paste/Max ${key} differs: ${JSON.stringify(inField.filter((b) => b[key] !== inField[0][key]).slice(0, 4))} vs ${JSON.stringify(inField[0])}`).toBe(1);
        }
        expect(results.flatMap((r) => r.faults.map((f) => `${r.route}: ${f}`))).toEqual([]);
    });
}

for (const viewport of VIEWPORTS) {
    test(`onboarding forms are consistent at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.setTimeout(4 * 60 * 1000);
        await page.setViewportSize(viewport);
        await page.goto('/', { waitUntil: 'commit' });
        await dismissIntroCarousel(page);
        const results = [];
        const record = async (route) => {
            await settle(page);
            results.push({ route, ...(await page.evaluate(formFaults)) });
            if (process.env.FORM_SWEEP_OUT) await page.screenshot({ path: `${process.env.FORM_SWEEP_OUT}/onb-${viewport.width}-${route.replace(/[^a-z0-9]+/gi, '-')}.png` }).catch(() => {});
        };
        await record('Welcome');
        for (const name of ['Create new wallet', 'Import wallet', 'From FreeWallet', 'Pair a watcher or signer']) {
            const button = page.getByRole('button', { name }).first();
            if (await button.count() === 0) continue;
            await button.click();
            await record(name);
            await page.goto('/', { waitUntil: 'commit' });
            await dismissIntroCarousel(page);
        }
        expect(results.reduce((n, r) => n + (r.counts.fields || 0), 0), 'the onboarding walk measured fields').toBeGreaterThan(2);
        expect(results.flatMap((r) => r.faults.map((f) => `${r.route}: ${f}`))).toEqual([]);
    });
}
