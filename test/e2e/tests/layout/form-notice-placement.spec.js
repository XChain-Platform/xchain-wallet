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
// same route-and-patch the async boundary spec uses. A forced state that is
// about the whole form (`notice`) must show as a notice; one about a single
// field or summary item (`fieldNote`) must show as a note beside it and never
// as a notice box. Set FORM_NOTICE_SHOTS to a directory to keep a screenshot per form
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
    // Destroy states its irreversibility the moment it opens, before any input.
    { label: 'Destroy', open: (page) => palette(page, 'Destroy'), trigger: async () => {} },
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
    {
        label: 'Settings sign throttle refused',
        fault: { fail: { 'settings.update': 'The settings service is unavailable.' } },
        open: (page) => settingsSubpage(page, 'Connected sites'),
        trigger: async (page) => {
            const main = page.getByRole('main');
            await main.getByLabel('Sign-throttle burst (max requests per window)').fill('5');
            await main.getByRole('button', { name: 'Apply', exact: true }).click();
        },
    },
    {
        label: 'Settings block history clear refused',
        fault: {
            reply: { 'sites.auditLog.list': [{ at: 1700000000000, action: 'add', entry: 'https://e2e-blocked.example' }] },
            fail: { 'sites.auditLog.clear': 'The site list service is unavailable.' },
        },
        open: async (page) => {
            await settingsSubpage(page, 'Connected sites');
            await expect(page.getByRole('main').getByRole('button', { name: 'Clear history', exact: true })).toBeEnabled();
        },
        trigger: async (page) => {
            await page.getByRole('main').getByRole('button', { name: 'Clear history', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: 'Clear history', exact: true }).click();
        },
    },
    {
        label: 'Settings publish labels without a password',
        open: async (page) => {
            await settingsSubpage(page, 'Backup');
            await page.getByRole('main').getByRole('button', { name: 'Publish now…', exact: true }).click();
            await expect(page.getByRole('main').getByLabel('Wallet password', { exact: true })).toBeVisible();
        },
        trigger: async (page) => {
            await page.getByRole('main').getByRole('button', { name: 'Publish', exact: true }).last().click();
        },
        close: (page) => page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).first().click(),
    },
    {
        label: 'Settings restore labels refused',
        fault: { fail: { 'wallet.restoreLabels': 'The label service is unavailable.' } },
        open: async (page) => {
            await settingsSubpage(page, 'Backup');
            await page.getByRole('main').getByRole('button', { name: 'Check…', exact: true }).click();
            await expect(page.getByRole('main').getByLabel('Wallet password', { exact: true })).toBeVisible();
        },
        trigger: async (page) => {
            const main = page.getByRole('main');
            await main.getByLabel('Wallet password', { exact: true }).fill('e2epassword1234');
            await main.getByRole('button', { name: 'Check', exact: true }).click();
        },
        close: (page) => page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).first().click(),
    },
    {
        label: 'Developer mode faucet amount missing',
        fault: { merge: { 'settings.get': { fees: { 'bitcoin-regtest': {} } }, 'settings.update': { fees: { 'bitcoin-regtest': {} } } } },
        open: openDeveloperFaucet,
        trigger: async (page) => {
            const main = page.getByRole('main');
            const amount = main.getByLabel(/^Amount \(/);
            await amount.fill('');
            // Enter submits the form from the field, the same route on a phone and a desktop.
            await amount.press('Enter');
        },
    },
    {
        label: 'Developer mode custom network unreadable',
        open: async (page) => {
            await openDeveloperMode(page);
            await page.getByRole('main').getByRole('button', { name: 'Add custom network…', exact: true }).click();
        },
        trigger: async (page) => {
            const main = page.getByRole('main');
            await main.getByLabel('Custom network descriptor JSON').fill('{ not json');
            await main.getByRole('button', { name: 'Add network', exact: true }).click();
        },
        close: (page) => page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).last().click(),
    },
    {
        label: 'Developer mode regtest activation refused',
        fault: { fail: { 'wallet.activateChain': 'The vault service is unavailable.' } },
        open: async (page) => {
            await openDeveloperMode(page);
            await page.getByRole('main').getByRole('button', { name: 'Activate…', exact: true }).first().click();
        },
        trigger: async (page) => {
            const main = page.getByRole('main');
            await main.getByLabel(/activation password$/).first().fill('e2epassword1234');
            await main.getByRole('button', { name: 'Activate', exact: true }).click();
        },
    },
    // A native amount under the dust floor is a note under the amount field, not a notice.
    { label: 'Send dust amount', open: (page) => gotoSection(page, 'Send'), trigger: sendDustAmount, fieldNote: /too small to send/ },
    // A destination this wallet does not own is a note under the destination field.
    {
        label: 'Sweep foreign destination',
        open: (page) => palette(page, 'Sweep address'),
        trigger: async (page) => {
            const field = page.getByRole('main').getByLabel('Destination address', { exact: true });
            await field.fill(EXTERNAL_ADDRESS);
            await field.press('Tab');
        },
        fieldNote: /Not your address/,
    },
    // A well-formed recipient for another network is a note under the recipients field.
    {
        label: 'Airdrop wrong-network recipient',
        open: (page) => palette(page, 'Airdrop'),
        trigger: async (page) => {
            const field = page.getByRole('main').getByLabel('Recipients', { exact: true });
            await field.fill(OTHER_NETWORK_ADDRESS);
            await field.press('Tab');
        },
        fieldNote: /for\s+another network/,
    },
    {
        label: 'List create wrong-network address',
        open: (page) => palette(page, 'Create a list'),
        trigger: async (page) => {
            const field = page.getByRole('main').getByLabel('Addresses', { exact: true });
            await field.fill(OTHER_NETWORK_ADDRESS);
            await field.press('Tab');
        },
        fieldNote: /for another\s+network/,
    },
    // A union states what it follows from the moment it opens.
    {
        label: 'Union list',
        open: async (page) => {
            await gotoSection(page, 'Lists');
            await page.getByRole('main').getByRole('button', { name: 'Create union list', exact: true }).click();
        },
        trigger: async () => {},
        notice: /A union follows each member/,
    },
    // Coin on both sides is a state of the whole order, so it is a notice above the card.
    {
        label: 'Create order coin for coin',
        open: (page) => palette(page, 'Create order'),
        trigger: async (page) => {
            await page.getByRole('main').getByRole('radio', { name: /^Native / }).first().check();
        },
        notice: /At least one side must be a token/,
    },
    // Source that exports no name is a note under the source field; the host
    // read of the source is answered through the fault seam.
    {
        label: 'Publish contract without meta',
        fault: { reply: { 'contracts.getExportedMeta': { status: 'absent' } } },
        open: (page) => openFromList(page, 'Contracts', /Publish contract/),
        trigger: async (page) => {
            const field = page.getByRole('main').getByLabel('Code source', { exact: true });
            await field.fill('export function main() { return 1; }');
            await field.press('Tab');
        },
        fieldNote: /exports no name or description/,
    },
    // A paste that is not a PSBT is a note under the paste field.
    {
        label: 'Sign transaction unreadable paste',
        open: (page) => palette(page, 'Sign a transaction'),
        trigger: async (page) => {
            const field = page.getByRole('main').getByLabel('Unsigned transaction (hex or base64)', { exact: true });
            await field.fill('deadbeef');
            await field.press('Tab');
        },
        fieldNote: /is not a PSBT/,
    },
    // A raw SEND states the token-gated rule for the whole action.
    {
        label: 'Advanced action raw send',
        // The host's action list is answered through the fault seam.
        fault: { reply: { 'sdk.listActions': ['SEND'] } },
        open: (page) => palette(page, 'Advanced action'),
        trigger: async (page) => {
            await page.getByRole('main').getByLabel('Action', { exact: true }).selectOption('SEND');
        },
        notice: /Token-gated content rule/,
    },
    // Last: an edited multisig form holds the page until its changes are dealt with.
    { label: 'Create multisig', open: (page) => palette(page, 'Create multisig'), trigger: multisigComposeError },
];

/**
 * Routes the web messaging module through a fault hook. A spec sets
 * globalThis.__xcFault = { fail: { '<message type>': '<error text>' }, reply, merge, hw }:
 * a listed message type rejects with that text, a type in reply answers with
 * the given value instead of asking the host, a type in merge has its fields
 * laid over the host's answer, and hw marks the newest
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
    if (fault?.reply && type in fault.reply) return fault.reply[type];
    const result = await sendToHost(type, request);
    if (fault?.merge?.[type] && result) return { ...result, ...fault.merge[type] };
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

/** Opens a Settings sub-page by its row title. */
async function settingsSubpage(page, section) {
    await openSettings(page);
    const back = page.getByRole('button', { name: 'Back to settings' }).filter({ visible: true }).first();
    if (await back.count()) await back.click();
    await page.getByRole('main').getByRole('button', { name: new RegExp(`^${section}`) }).first().click();
}

/** Developer mode opens with its switch off; turn it on so the regtest forms show. */
async function openDeveloperMode(page) {
    await settingsSubpage(page, 'Developer mode');
    const developerSwitch = page.getByRole('switch', { name: 'Turn on developer mode', exact: true });
    if (!(await developerSwitch.isChecked())) await developerSwitch.click();
    await expect(page.getByRole('main').getByText('Regtest networks')).toBeVisible();
}

/** The faucet shows once a regtest network has a fee entry; the fault gives settings one. */
async function openDeveloperFaucet(page) {
    await openDeveloperMode(page);
    await expect(page.getByRole('main').getByText('Regtest faucet')).toBeVisible();
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

/** An address no wallet in the run owns. */
const EXTERNAL_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
/** A well-formed address for a network the run's wallet does not use. */
const OTHER_NETWORK_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

/** Send to an outside address with one satoshi, under every chain's dust floor. */
async function sendDustAmount(page) {
    const main = page.getByRole('main');
    await main.locator('#send-destination').fill(EXTERNAL_ADDRESS);
    const amount = main.locator('#send-amount');
    await amount.fill('0.00000001');
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
                full: (el.innerText || '').replace(/\s+/g, ' ').trim(),
                text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                width: Math.round(el.getBoundingClientRect().width),
                column: Math.round(column),
                card: card ? describe(card) : null,
                inForm: !!el.closest('form'),
            };
        });
}

/** Runs in the page. The text of every visible field note (FieldNote) in the page content. */
function measureFieldNotes() {
    const main = document.querySelector('main');
    if (!main) return [];
    return [...main.querySelectorAll('[data-field-note]')]
        .filter((el) => el.getBoundingClientRect().height > 1 && !el.closest('[role="dialog"]'))
        .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim());
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
                    faults.push(`${form.label}: could not open or submit (${String(error.message).split('\n').slice(0, 4).join(' | ')})`);
                    continue;
                }
                const notices = await page.evaluate(measureNotices);
                const fieldNotes = await page.evaluate(measureFieldNotes);
                seen.push(`${form.label}: ${notices.length} notice(s)${notices.map((n) => `\n    "${n.text}" ${n.width}/${n.column}px${n.card ? ` in ${n.card}` : ''}${n.inForm ? ' (in form)' : ''}`).join('')}${fieldNotes.map((text) => `\n    field note "${text.slice(0, 60)}"`).join('')}`);
                // A forced state must show: a page-level state as a notice, a
                // field-level one as a note under its field and never as a notice.
                if (form.notice && !notices.some((n) => form.notice.test(n.full))) {
                    faults.push(`${form.label}: no notice matching ${form.notice}`);
                }
                if (form.fieldNote) {
                    if (!fieldNotes.some((text) => form.fieldNote.test(text))) faults.push(`${form.label}: no field note matching ${form.fieldNote}`);
                    const boxed = notices.find((n) => form.fieldNote.test(n.full));
                    if (boxed) faults.push(`${form.label}: a field note is drawn as a notice ("${boxed.text}")`);
                }
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
