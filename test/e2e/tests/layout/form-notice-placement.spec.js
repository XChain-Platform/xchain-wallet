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
// card. Failures that need the host to refuse (a load, a generate, a hardware
// check, a password change) are forced through the web messaging seam, the
// same route-and-patch the async boundary spec uses. Set FORM_NOTICE_SHOTS to a directory to keep a screenshot per form
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

const ONLY = process.env.FORM_NOTICE_ONLY ? new RegExp(process.env.FORM_NOTICE_ONLY, 'i') : null;

const ALL_FORMS = [
    { label: 'Send', open: (page) => gotoSection(page, 'Send') },
    { label: 'Receive', open: (page) => gotoSection(page, 'Receive'), trigger: receiveAmountError, fieldError: true },
    {
        label: 'Receive load error',
        fault: { fail: { 'addresses.newest': 'The address service is unavailable.' } },
        open: openReceiveFresh,
        trigger: async () => {},
    },
    {
        label: 'Receive generate error',
        fault: { fail: { 'receive.getAddress': 'The address service is unavailable.' } },
        open: openReceiveFresh,
        trigger: async (page) => {
            await page.getByRole('main').getByRole('button', { name: /new address/i }).first().click();
        },
    },
    {
        label: 'Receive hardware verify error',
        fault: { hw: true, fail: { 'receive.verifyAddress': 'The device is not connected.' } },
        open: openReceiveFresh,
        trigger: async (page) => {
            await page.getByRole('main').getByRole('button', { name: /^Verify on your/ }).first().click();
        },
    },
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
    {
        label: 'Settings change password refused',
        fault: { fail: { 'wallet.changePassword': 'The vault service is unavailable.' } },
        open: (page) => settingsForm(page, 'This wallet', 'Change…'),
        trigger: async (page) => {
            const main = page.getByRole('main');
            await main.getByLabel('Current wallet password').fill('e2epassword1234');
            await main.getByLabel('New wallet password', { exact: true }).fill('e2enewpassword5678');
            await main.getByLabel('Confirm new wallet password').fill('e2enewpassword5678');
            await main.locator('form button[type="submit"]').filter({ visible: true }).last().click();
        },
        close: (page) => page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).first().click(),
    },
    {
        label: 'Settings public keys refused',
        fault: { fail: { 'pairing.payload': 'The vault service is unavailable.' } },
        open: async (page) => {
            await openSettings(page);
            const back = page.getByRole('button', { name: 'Back to settings' }).filter({ visible: true }).first();
            if (await back.count()) await back.click();
            await page.getByRole('main').getByRole('button', { name: /^This wallet/ }).first().click();
            await page.getByRole('main').getByRole('button', { name: 'Export…', exact: true }).first().click();
        },
        trigger: async (page) => {
            const main = page.getByRole('main');
            await main.getByLabel('Confirm wallet password').fill('e2epassword1234');
            await main.locator('form button[type="submit"]').filter({ visible: true }).last().click();
        },
        close: (page) => page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).first().click(),
    },
    {
        label: 'Settings remove wallet refused',
        fault: { fail: { 'wallet.remove': 'The vault service is unavailable.' } },
        open: async (page) => {
            await openSettings(page);
            const back = page.getByRole('button', { name: 'Back to settings' }).filter({ visible: true }).first();
            if (await back.count()) await back.click();
            await page.getByRole('main').getByRole('button', { name: /^This wallet/ }).first().click();
            await page.getByRole('main').getByRole('button', { name: 'Remove…', exact: true }).first().click();
        },
        trigger: async (page) => {
            const main = page.getByRole('main');
            const name = await main.getByLabel('Confirm wallet name').getAttribute('placeholder');
            await main.getByLabel('Confirm wallet name').fill(name);
            await main.getByRole('button', { name: 'Remove wallet', exact: true }).click();
        },
        close: (page) => page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).first().click(),
    },
    // Last: an edited multisig form holds the page until its changes are dealt with.
    { label: 'Create multisig', open: (page) => palette(page, 'Create multisig'), trigger: multisigComposeError },
];

/**
 * Routes the web messaging module through a fault hook. A spec sets
 * globalThis.__xcFault = { fail: { '<message type>': '<error text>' }, hw }:
 * a listed message type rejects with that text, and hw marks the newest
 * receive address as a hardware-signer address so its verify control shows.
 */
async function installFaultSeam(page) {
    await page.route('**/src/messaging.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const original = `    const { sendMessage: sendToHost } = await loadHostBridge();
    return sendToHost(type, request);`;
        if (!source.includes(original)) throw new Error('The web messaging seam changed; update the fault seam.');
        const replacement = `    const { sendMessage: sendToHost } = await loadHostBridge();
    const fault = globalThis.__xcFault;
    if (fault?.fail?.[type]) throw new Error(fault.fail[type]);
    const result = await sendToHost(type, request);
    const asLedger = (address) => ({ ...address, source: 'ledger', signerId: 'e2e-ledger' });
    if (fault?.hw && type === 'addresses.newest' && result) return asLedger(result);
    if (fault?.hw && type === 'addresses.byChain' && result) {
        return Object.fromEntries(Object.entries(result).map(([chain, list]) => [chain, Array.isArray(list) ? list.map(asLedger) : list]));
    }
    return result;`;
        await route.fulfill({ response, body: source.replace(original, replacement) });
    });
}

const setFault = (page, fault) => page.evaluate((value) => { globalThis.__xcFault = value; }, fault || null);

/** Receive keeps its address and any error while mounted, so leave it first and let the fault meet a fresh load. */
async function openReceiveFresh(page) {
    await gotoSection(page, 'Send');
    await gotoSection(page, 'Receive');
}

const FORMS = ONLY ? ALL_FORMS.filter((form) => ONLY.test(form.label)) : ALL_FORMS;

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
    await amount.fill('0.123456789012345');
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
        test.use({ viewport, actionTimeout: 45_000 });

        test('no notice sits inside a form card', async ({ page }, testInfo) => {
            test.setTimeout(testInfo.timeout * 3);
            await installFaultSeam(page);
            await createWallet(page);
            const faults = [];
            const seen = [];
            let formsWithNotices = 0;
            for (const form of FORMS) {
                try {
                    await setFault(page, form.fault);
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
                await setFault(page, null);
                if (notices.length > 0) formsWithNotices += 1;
                if (form.fieldError && notices.length > 0) {
                    faults.push(`${form.label}: a field error is drawn as a notice ("${notices[0].text}")`);
                }
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
            if (!ONLY) expect(formsWithNotices, 'forms that showed a notice').toBeGreaterThanOrEqual(8);
        });
    });
}
