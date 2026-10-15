// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A notice is the first item of the page content, never a box inside a box.
// On a wide screen a form is drawn as one card (FormPage), so its notices sit
// above that card at the full content width; on a phone the form is bare and
// they lead its content. Walk the main forms at a desktop, a laptop, a
// landscape phone and a portrait phone, submit each one empty so its
// validation summary or form error shows, and measure every notice in the
// page content: at 600px and wider none of them may sit inside a bordered
// card. Set FORM_NOTICE_SHOTS to a directory to keep a screenshot per form
// and size.

import { mkdirSync } from 'node:fs';
import {
    createWallet,
    expect,
    gotoSection,
    openSettings,
    test,
} from '../../fixtures/wallet.js';

const VIEWPORTS = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 866, height: 364 },
    { width: 360, height: 800 },
];

// The form template's own breakpoint (FormPage.module.css).
const WIDE_MIN = 600;

const FORMS = [
    { label: 'Send', open: (page) => gotoSection(page, 'Send') },
    { label: 'Receive', open: (page) => gotoSection(page, 'Receive'), trigger: receiveAmountError },
    { label: 'Issue token', open: (page) => palette(page, 'Issue token') },
    { label: 'Create dispenser', open: (page) => palette(page, 'Create dispenser') },
    { label: 'Airdrop', open: (page) => palette(page, 'Airdrop') },
    { label: 'Broadcast a message', open: (page) => palette(page, 'Broadcast a message') },
    { label: 'Compose message', open: (page) => openFromList(page, 'Messaging', 'New message') },
    { label: 'Publish contract', open: (page) => openFromList(page, 'Contracts', /Publish contract/) },
    { label: 'Sweep address', open: (page) => palette(page, 'Sweep address') },
    {
        label: 'Settings change password',
        open: (page) => settingsForm(page, 'This wallet', 'Change…'),
        // The open inline form keeps the palette shortcut in its password field.
        close: (page) => page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).first().click(),
    },
    // Last: an edited multisig form holds the page until its changes are dealt with.
    { label: 'Create multisig', open: (page) => palette(page, 'Create multisig'), trigger: multisigComposeError },
];

async function palette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').first().fill(title);
    await page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(dialog).toBeHidden();
}

async function openFromList(page, title, action) {
    await palette(page, title);
    await page.getByRole('main').getByRole('button', { name: action }).first().click();
}

async function settingsForm(page, section, action) {
    await openSettings(page);
    // Settings reopens on the last section; step back to the list first.
    const back = page.getByRole('button', { name: 'Back to settings' }).filter({ visible: true }).first();
    if (await back.count()) await back.click();
    await page.getByRole('main').getByRole('button', { name: new RegExp(`^${section}`) }).first().click();
    await page.getByRole('main').getByRole('button', { name: action, exact: true }).first().click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).first()).toBeVisible();
}

/** Submits the form empty so its validation summary or form error shows. */
async function submitEmpty(page) {
    const submit = page.getByRole('main').locator('form button[type="submit"]').filter({ visible: true }).last();
    if (await submit.count() === 0 || !(await submit.isEnabled())) return;
    await submit.click();
}

/** Receive has no submit; an amount it cannot read shows its field error under the field, not a notice. */
async function receiveAmountError(page) {
    const amount = page.getByRole('main').getByLabel(/amount/i).first();
    if (await amount.count() === 0) return;
    await amount.fill('1.2.3');
    await amount.press('Tab');
}

/** Create multisig reports a key it cannot read once a field is edited. */
async function multisigComposeError(page) {
    const key = page.getByRole('main').getByLabel(/Public key/).first();
    await key.fill('zz');
    await key.press('Tab');
}

async function settle(page) {
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' }).catch(() => {});
    await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await page.waitForTimeout(600);
}

/**
 * Runs in the page. Every visible notice in the page content, with the card
 * (a box with a border on all four sides and rounded corners) it sits in, if
 * any, and its width against the content column (main less its gutter).
 */
function measureNotices() {
    const main = document.querySelector('main');
    if (!main) return [];
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const isCard = (el) => {
        const cs = getComputedStyle(el);
        const bordered = ['Top', 'Right', 'Bottom', 'Left'].every((side) => cs[`border${side}Style`] !== 'none'
            && parseFloat(cs[`border${side}Width`]) >= 1);
        return bordered && parseFloat(cs.borderTopLeftRadius) > 0;
    };
    const describe = (el) => {
        const cls = [...el.classList].map((c) => c.replace(/^_|_[a-z0-9]{5,}$/gi, '')).join('.');
        return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
    };
    return [...main.querySelectorAll('[data-variant]')]
        .filter((el) => visible(el) && !el.closest('[role="dialog"]') && !el.parentElement.closest('[data-variant]'))
        .map((el) => {
            let card = null;
            for (let a = el.parentElement; a && a !== main; a = a.parentElement) {
                if (isCard(a)) { card = a; break; }
            }
            const cs = getComputedStyle(main);
            const column = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            return {
                text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                width: Math.round(el.getBoundingClientRect().width),
                column: Math.round(column),
                card: card ? describe(card) : null,
                inForm: !!el.closest('form'),
            };
        });
}

const shots = process.env.FORM_NOTICE_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

for (const viewport of VIEWPORTS) {
    const size = `${viewport.width}x${viewport.height}`;
    test.describe(`form notices at ${size}`, () => {
        test.use({ viewport });

        test('no notice sits inside a form card', async ({ page }, testInfo) => {
            test.setTimeout(testInfo.timeout * 3);
            await createWallet(page);
            const faults = [];
            const seen = [];
            let formsWithNotices = 0;
            for (const form of FORMS) {
                try {
                    await form.open(page);
                    await page.waitForTimeout(800);
                    await (form.trigger || submitEmpty)(page);
                    await settle(page);
                } catch (error) {
                    faults.push(`${form.label}: could not open or submit (${String(error.message).split('\n')[0]})`);
                    continue;
                }
                const notices = await page.evaluate(measureNotices);
                seen.push(`${form.label}: ${notices.length} notice(s)${notices.map((n) => `\n    "${n.text}" ${n.width}/${n.column}px${n.card ? ` in ${n.card}` : ''}${n.inForm ? ' (in form)' : ''}`).join('')}`);
                if (shots) {
                    await page.screenshot({ path: `${shots}/${form.label.replace(/\W+/g, '-').toLowerCase()}-${size}.png` });
                }
                await form.close?.(page);
                if (notices.length > 0) formsWithNotices += 1;
                if (viewport.width < WIDE_MIN) continue;
                for (const notice of notices) {
                    if (notice.card) faults.push(`${form.label}: notice "${notice.text}" sits inside ${notice.card}`);
                    else if (notice.width < notice.column - 2) {
                        faults.push(`${form.label}: notice "${notice.text}" is ${notice.width}px of a ${notice.column}px content column`);
                    }
                }
            }
            testInfo.annotations.push({ type: 'notices', description: seen.join('\n') });
            console.log(`[${size}]\n${seen.join('\n')}`);
            expect(faults, faults.join('\n')).toEqual([]);
            // Guard against a walk that measured nothing: most forms raise a notice.
            expect(formsWithNotices, 'forms that showed a notice').toBeGreaterThanOrEqual(8);
        });
    });
}
