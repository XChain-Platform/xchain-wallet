// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    readReceiveAddress,
    REGTEST_CHAIN_LABEL,
    selectVenueChain,
    switchToRegtest,
} from '../../fixtures/regtest.js';

const PASSWORD = 'signverifye2epassword';
const MESSAGE = 'XChain sign and verify e2e message';
const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

async function settleLayout(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectNoHorizontalOverflow(page, label) {
    await settleLayout(page);
    const measurements = await page.evaluate(() => {
        const nodes = [document.documentElement, document.body, ...document.querySelectorAll('main')];
        return nodes
            .filter((node) => node.getBoundingClientRect().width > 0)
            .map((node) => ({
                name: node.tagName.toLowerCase(),
                clientWidth: node.clientWidth,
                scrollWidth: node.scrollWidth,
            }));
    });

    for (const measurement of measurements) {
        expect(
            measurement.scrollWidth,
            `${label}: ${measurement.name} overflows horizontally `
                + `(${measurement.scrollWidth}px into ${measurement.clientWidth}px)`,
        ).toBeLessThanOrEqual(measurement.clientWidth + 1);
    }
}

async function expectSharedLineHeights(controls, label) {
    const boxes = (await controls.evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
    }))).filter((box) => box.height > 0);

    expect(boxes.length, `${label}: expected at least two rendered controls`).toBeGreaterThanOrEqual(2);
    const topSpread = Math.max(...boxes.map((box) => box.top))
        - Math.min(...boxes.map((box) => box.top));
    if (topSpread > 2) return;

    const heightSpread = Math.max(...boxes.map((box) => box.height))
        - Math.min(...boxes.map((box) => box.height));
    expect(heightSpread, `${label}: controls on one line differ in height`).toBeLessThanOrEqual(2);
}

async function expectScreen(page, heading, label) {
    await expect(page.getByRole('heading', { name: heading, exact: true }).first())
        .toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page, label);

    const bottomNavigation = page.getByRole('navigation', { name: 'Bottom navigation' });
    if (await bottomNavigation.count() > 0) {
        await expectSharedLineHeights(
            bottomNavigation.getByRole('button'),
            `${label} bottom navigation`,
        );
    }
}

async function openPaletteRoute(page, command, heading, formName) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible({ timeout: 15_000 });
    await palette.getByRole('combobox').first().fill(command);
    await palette.getByRole('option', { name: new RegExp(`^${command}\\b`) }).first().click();
    await expect(palette).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: heading, exact: true }).first())
        .toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('form', { name: formName, exact: true }))
        .toBeVisible({ timeout: 30_000 });
}

async function signAndVerify(page, viewportName) {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await createWallet(page, { password: PASSWORD, name: `Sign verify ${viewportName}` });
    await switchToRegtest(page, PASSWORD);
    const address = await readReceiveAddress(page);

    await openPaletteRoute(page, 'Sign a message', 'Sign message', 'Sign message');
    const signForm = page.getByRole('form', { name: 'Sign message', exact: true });
    await selectVenueChain(signForm, 'Chain');
    const addressField = signForm.getByLabel('Address', { exact: true });
    const addressOption = addressField.locator('option').filter({ hasText: address });
    await expect(addressOption, 'the sign form does not offer the active address').toHaveCount(1);
    const addressId = await addressOption.getAttribute('value');
    expect(addressId, 'the active address option has no address id').toBeTruthy();
    await addressField.selectOption(addressId);
    await signForm.getByLabel('Message', { exact: true }).fill(MESSAGE);
    await expectScreen(page, 'Sign message', `${viewportName} sign form`);

    await signForm.getByRole('button', { name: 'Sign message', exact: true }).click();
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await expectScreen(page, 'Confirm', `${viewportName} sign review`);
    expect(
        await page.getByRole('main').evaluate((main) => main.scrollTop),
        `${viewportName} sign review did not open at the top`,
    ).toBeLessThanOrEqual(1);
    await expect(confirm).toContainText('Sign this message');
    await expect(confirm.getByTestId('confirm-message-text')).toHaveText(MESSAGE);
    await expect(confirm.getByTestId('confirm-chain-badge')).toHaveText(REGTEST_CHAIN_LABEL);
    await expect(confirm.getByTestId('confirm-source')).toContainText(address);
    await expectSharedLineHeights(
        confirm.locator('footer').getByRole('button'),
        `${viewportName} sign review actions`,
    );

    const approve = confirm.getByTestId('confirm-approve');
    await expect(approve).toBeEnabled({ timeout: 30_000 });
    await approve.click();

    const copySignature = page.getByRole('button', { name: 'Copy signature', exact: true });
    await expect(copySignature).toBeVisible({ timeout: 30_000 });
    await expectScreen(page, 'Sign message', `${viewportName} signed result`);
    const resultValues = page.getByRole('main').locator('pre');
    await expect(resultValues).toHaveCount(2);
    await expect(resultValues.first()).toHaveText(MESSAGE);
    const signature = (await resultValues.nth(1).textContent() || '').trim();
    expect(signature, 'signing returned no base64 signature').toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    await copySignature.click();
    await expect(copySignature).toHaveAttribute('data-state', 'copied');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(signature);

    await openPaletteRoute(
        page,
        'Verify a signature',
        'Verify signature',
        'Verify signature',
    );
    const verifyForm = page.getByRole('form', { name: 'Verify signature', exact: true });
    await selectVenueChain(verifyForm, 'Chain');
    await verifyForm.getByLabel('Address', { exact: true }).fill(address);
    await verifyForm.getByLabel('Message', { exact: true }).fill(MESSAGE);
    const signatureField = verifyForm.getByLabel('Signature', { exact: true });
    await signatureField.focus();
    await page.keyboard.press('ControlOrMeta+V');
    await expect(signatureField).toHaveValue(signature);
    await expectScreen(page, 'Verify signature', `${viewportName} verify form`);

    await verifyForm.getByRole('button', { name: 'Verify signature', exact: true }).click();
    await expect(verifyForm.getByRole('status')).toContainText(
        'Valid signature. Signature matches this message and address.',
        { timeout: 30_000 },
    );
    await expectScreen(page, 'Verify signature', `${viewportName} verified result`);
}

export function defineSignVerifyTests() {
    test.describe('sign message and verify signature', () => {
        for (const viewport of VIEWPORTS) {
            test.describe(viewport.name, () => {
                test.use({ viewport: { width: viewport.width, height: viewport.height } });

                test('signs with an address and verifies the copied signature', async ({ page }) => {
                    await signAndVerify(page, viewport.name);
                });
            });
        }
    });
}
