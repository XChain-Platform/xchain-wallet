// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    createWallet,
    expect,
    gotoSection,
    openSettings,
    test,
} from '../../fixtures/wallet.js';

const VIEWPORT = { width: 1280, height: 800 };
const INTERACTIVE_SELECTOR = [
    'button:not(:disabled)',
    'a[href]',
    'input:not(:disabled):not([type="hidden"])',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

async function expectVisualTabOrderAndFocusRings(page, form, label) {
    const controls = await form.locator(INTERACTIVE_SELECTOR).evaluateAll((elements) => {
        // A native radio group is one Tab stop: the checked radio, or the
        // first one while none is checked. Arrow keys move within the group.
        const radioStop = (element) => {
            if (element.type !== 'radio' || !element.name) return true;
            const group = [...(element.form || document).querySelectorAll('input[type="radio"]')]
                .filter((radio) => radio.name === element.name);
            const checked = group.find((radio) => radio.checked);
            return checked ? checked === element : group[0] === element;
        };
        const visible = elements.filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            // Content of a closed disclosure is not focusable until it opens.
            const closedDisclosure = element.closest('details:not([open])');
            const insideClosed = closedDisclosure && !element.closest('summary');
            return element.tabIndex >= 0
                && !insideClosed
                && radioStop(element)
                && style.visibility !== 'hidden'
                && style.display !== 'none'
                && rect.width > 0
                && rect.height > 0;
        });
        return visible.map((element, index) => {
            const marker = `${index}`;
            const rect = element.getBoundingClientRect();
            element.dataset.e2eFormControl = marker;
            return { marker, top: rect.top, left: rect.left };
        });
    });
    expect(controls.length, `${label}: the form has no keyboard controls`).toBeGreaterThan(0);

    await page.locator('body').evaluate((body) => {
        body.dataset.e2eOriginalTabindex = body.getAttribute('tabindex') ?? '';
        body.setAttribute('tabindex', '-1');
        body.focus();
    });

    const pageStops = await page.locator(INTERACTIVE_SELECTOR).evaluateAll((elements) => (
        elements.filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return element.tabIndex >= 0
                && style.visibility !== 'hidden'
                && style.display !== 'none'
                && rect.width > 0
                && rect.height > 0;
        }).length
    ));
    const reached = [];
    const missingRings = [];
    // Chromium also stops on elements this count leaves out (disclosure
    // summaries such as the reachability notice's Details, and keyboard-
    // focusable scroll containers), so the walk allows a margin past the
    // count; it still ends as soon as every form control has been reached.
    for (let index = 0; index <= pageStops * 2 + 10; index += 1) {
        await page.keyboard.press('Tab');
        const stop = await page.evaluate(() => {
            const element = document.activeElement;
            const marker = element?.dataset.e2eFormControl;
            if (marker === undefined) return null;

            const paintsRing = (node, pseudo = null) => {
                const style = getComputedStyle(node, pseudo);
                const hasOutline = style.outlineStyle !== 'none'
                    && (parseFloat(style.outlineWidth) || 0) >= 1;
                const hasShadow = style.boxShadow !== 'none'
                    && !style.boxShadow.startsWith('rgba(0, 0, 0, 0)');
                return hasOutline || hasShadow;
            };
            let ring = paintsRing(element)
                || paintsRing(element, '::before')
                || paintsRing(element, '::after');
            if (!ring) {
                ring = [...element.querySelectorAll('*')].some((child) => (
                    paintsRing(child)
                    || paintsRing(child, '::before')
                    || paintsRing(child, '::after')
                ));
            }
            return {
                marker,
                ring,
                focusVisible: element.matches(':focus-visible'),
                name: element.getAttribute('aria-label')
                    || element.labels?.[0]?.textContent?.trim()
                    || element.textContent?.trim()
                    || element.tagName.toLowerCase(),
            };
        });
        if (!stop) continue;
        reached.push(stop.marker);
        if (!stop.focusVisible || !stop.ring) missingRings.push(stop.name);
        if (reached.length === controls.length) break;
    }

    await page.evaluate(() => {
        document.querySelectorAll('[data-e2e-form-control]').forEach((element) => {
            delete element.dataset.e2eFormControl;
        });
        const body = document.body;
        const original = body.dataset.e2eOriginalTabindex;
        delete body.dataset.e2eOriginalTabindex;
        if (original) body.setAttribute('tabindex', original);
        else body.removeAttribute('tabindex');
    });

    expect(reached, `${label}: every form control is reachable in DOM order`)
        .toEqual(controls.map(({ marker }) => marker));
    for (let index = 1; index < controls.length; index += 1) {
        const previous = controls[index - 1];
        const current = controls[index];
        const movesDown = current.top >= previous.top - 3;
        const staysLeftToRight = Math.abs(current.top - previous.top) > 3
            || current.left >= previous.left - 3;
        expect(
            movesDown && staysLeftToRight,
            `${label}: Tab moves from control ${previous.marker} at (${previous.left}, ${previous.top}) `
                + `to control ${current.marker} at (${current.left}, ${current.top})`,
        ).toBe(true);
    }
    expect(missingRings, `${label}: every keyboard-focused control paints a visible ring`)
        .toEqual([]);
}

async function installSubmitCounter(form) {
    await form.evaluate((element) => {
        element.dataset.e2eSubmitCount = '0';
        element.addEventListener('submit', () => {
            element.dataset.e2eSubmitCount = `${Number(element.dataset.e2eSubmitCount || 0) + 1}`;
        }, { capture: true });
    });
}

async function resetSubmitCounter(form) {
    await form.evaluate((element) => { element.dataset.e2eSubmitCount = '0'; });
}

async function expectSubmitCount(form, count, label) {
    await expect(form, label).toHaveAttribute('data-e2e-submit-count', `${count}`);
}

async function expectEnterSubmissionBoundaries(page, {
    form,
    firstField,
    lastField,
    submitButton,
    label,
}) {
    await installSubmitCounter(form);

    await firstField.focus();
    await page.keyboard.press('Enter');
    await expectSubmitCount(form, 0, `${label}: Enter in an earlier field must not submit`);

    await lastField.focus();
    await page.keyboard.press('Enter');
    await expectSubmitCount(form, 1, `${label}: Enter in the last field submits once`);

    if (submitButton) {
        await resetSubmitCounter(form);
        await submitButton.click();
        await expectSubmitCount(form, 1, `${label}: the submit button submits once`);
    }
}

async function expectHeaderMenuEscapeKeepsForm(page, form, label) {
    const trigger = page.getByRole('button', { name: 'Open menu' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Header actions' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(form, `${label}: Escape must leave the current form mounted`).toBeVisible();
}

test.describe('keyboard form contracts at 1280 by 800', () => {
    test('Send, Receive request amount, Create token, and password security follow one contract', async ({ page }) => {
        test.slow();
        await page.setViewportSize(VIEWPORT);
        // Demo wallets cannot submit Send, so this walk uses a real dev wallet.
        await createWallet(page);

        await test.step('Send', async () => {
            // A new wallet has no contacts; save one so the recipient field
            // has a suggestion to offer.
            await gotoSection(page, 'Contacts');
            await page.getByRole('button', { name: 'Create first contact' }).click();
            await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Erin');
            await page.getByRole('textbox', { name: 'Address', exact: true })
                .fill('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await expect(page.getByRole('list', { name: 'Contacts' })
                .getByText('Erin', { exact: true })).toBeVisible();

            await gotoSection(page, 'Send');
            const form = page.getByRole('form', { name: 'Send' });
            await expect(form).toBeVisible();
            await expectVisualTabOrderAndFocusRings(page, form, 'Send');

            const destination = form.getByRole('combobox', { name: /^To/ });
            await destination.fill('Erin');
            await expect(form.getByRole('listbox')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(form.getByRole('listbox')).toHaveCount(0);
            await expect(form).toBeVisible();
            await destination.clear();

            await expectEnterSubmissionBoundaries(page, {
                form,
                firstField: destination,
                lastField: form.getByRole('textbox', { name: /^Amount/ }),
                submitButton: form.getByRole('button', { name: 'Send', exact: true }),
                label: 'Send',
            });
        });

        await test.step('Receive request amount', async () => {
            await gotoSection(page, 'Receive');
            const form = page.getByRole('form', { name: 'Receive payment' });
            await expect(form).toBeVisible();
            await expect(form.getByRole('textbox', { name: /^Amount/ })).toBeVisible();
            await expect(form.getByRole('textbox', { name: 'Address label' })).toBeVisible();
            await expectVisualTabOrderAndFocusRings(page, form, 'Receive request amount');

            const addressType = form.getByLabel('Address type');
            const originalType = await addressType.inputValue();
            await addressType.focus();
            await page.keyboard.press('Alt+ArrowDown');
            await page.keyboard.press('Escape');
            await expect(addressType).toHaveValue(originalType);
            await expect(form).toBeVisible();

            await expectEnterSubmissionBoundaries(page, {
                form,
                firstField: form.getByRole('textbox', { name: 'Address label' }),
                lastField: form.getByRole('textbox', { name: /^Amount/ }),
                label: 'Receive request amount',
            });
        });

        await test.step('Create token', async () => {
            await gotoSection(page, 'Home');
            const createToken = page.getByRole('main').getByRole('button', { name: 'Create token' });
            await expect(createToken).toBeVisible();
            await createToken.click();
            const custom = page.getByRole('button', { name: /^Custom/ });
            await expect(custom).toBeVisible();
            await custom.click();

            const chainForm = page.getByRole('form', { name: 'Choose token network' });
            await expect(chainForm).toBeVisible();
            const network = chainForm.getByRole('button', { name: /^Network:/ });
            await expect(network).toBeVisible();
            await network.click();
            await expect(chainForm.getByRole('listbox', { name: 'Network' })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(chainForm.getByRole('listbox', { name: 'Network' })).toHaveCount(0);
            await expect(chainForm).toBeVisible();
            const next = chainForm.getByRole('button', { name: 'Next' });
            await expect(next).toBeEnabled();
            await next.click();

            const form = page.getByRole('form', { name: 'Token details' });
            await expect(form).toBeVisible();
            await expectVisualTabOrderAndFocusRings(page, form, 'Create token');
            await expectEnterSubmissionBoundaries(page, {
                form,
                firstField: form.getByRole('textbox', { name: 'Token name (ticker)' }),
                lastField: form.getByRole('textbox').last(),
                submitButton: form.getByRole('button', { name: 'Review token' }),
                label: 'Create token',
            });
        });

        await test.step('Settings password security', async () => {
            await openSettings(page);
            const walletRow = page.getByRole('main').getByRole('button', { name: /^This wallet/ });
            await expect(walletRow).toBeVisible();
            await walletRow.click();
            const changePassword = page.getByRole('main').getByRole('button', { name: 'Change…' });
            await expect(changePassword).toBeVisible();
            await changePassword.click();

            const heading = page.getByRole('heading', { name: 'Change wallet password' });
            const form = heading.locator('xpath=ancestor::form');
            await expect(form).toBeVisible();
            await expectVisualTabOrderAndFocusRings(page, form, 'Settings password security');
            await expectHeaderMenuEscapeKeepsForm(page, form, 'Settings password security');
            await expectEnterSubmissionBoundaries(page, {
                form,
                firstField: form.getByLabel('Current wallet password'),
                lastField: form.getByLabel('Confirm new wallet password'),
                submitButton: form.getByRole('button', { name: 'Change password' }),
                label: 'Settings password security',
            });
        });
    });
});
