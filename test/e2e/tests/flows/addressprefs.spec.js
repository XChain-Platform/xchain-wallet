// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    createWallet,
    expect,
    test,
} from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    overflowingElements,
} from '../../fixtures/responsive.js';

const LABEL = 'Daily receive address';
const MEMO = 'E2E address preferences';
const VIEWPORTS = [
    { width: 412, height: 869 },
    { width: 1280, height: 800 },
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    const search = palette.getByRole('combobox').first();
    await search.fill(title);
    await palette.getByRole('option', {
        name: new RegExp(`^${title}\\b`),
    }).first().click();
    await expect(palette).toBeHidden();
}

async function expectScreenLayout(page, heading, label) {
    await expect(page.getByRole('heading', {
        level: 1,
        name: heading,
        exact: true,
    })).toBeVisible();
    await settle(page);

    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: content paints outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const documentSize = await documentOverflow(page);
    expect(
        documentSize.scrollWidth,
        `${label}: document width ${documentSize.scrollWidth}px exceeds ${documentSize.clientWidth}px`,
    ).toBeLessThanOrEqual(documentSize.clientWidth + 1);

    const report = await page.getByRole('main').evaluate((main) => {
        const seen = new Set();
        const controls = [];
        const selector = [
            'button',
            'a[href]',
            'input:not([type="hidden"])',
            'select',
            'textarea',
            '[role="button"]',
            '[role="tab"]',
        ].join(', ');

        for (const candidate of main.querySelectorAll(selector)) {
            const inputType = candidate instanceof HTMLInputElement ? candidate.type : '';
            const target = (inputType === 'checkbox' || inputType === 'radio')
                ? candidate.closest('label') || candidate
                : candidate;
            if (seen.has(target)) continue;
            // An aria-hidden subtree is decoration, not a control: the fee slider's
            // tick labels sit there, and only tier ticks carry an ETA line.
            if (target.closest('[aria-hidden="true"]')) continue;
            seen.add(target);

            const style = getComputedStyle(target);
            const box = target.getBoundingClientRect();
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            if (box.width === 0 || box.height === 0) continue;
            controls.push({
                name: target.getAttribute('aria-label')
                    || target.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60)
                    || target.tagName.toLowerCase(),
                top: box.top,
                center: (box.top + box.bottom) / 2,
                bottom: box.bottom,
                height: box.height,
            });
        }

        controls.sort((a, b) => a.center - b.center);
        const lines = [];
        for (const control of controls) {
            const line = lines.find((entry) => entry.controls.some((item) => (
                Math.abs(item.top - control.top) <= 2
                || Math.abs(item.center - control.center) <= 2
                || Math.abs(item.bottom - control.bottom) <= 2
            )));
            if (line) {
                line.controls.push(control);
            } else {
                lines.push({ controls: [control] });
            }
        }

        return {
            mainScrollWidth: main.scrollWidth,
            mainClientWidth: main.clientWidth,
            unevenLines: lines
                .filter((line) => line.controls.length > 1)
                .map((line) => {
                    const heights = line.controls.map((control) => control.height);
                    return {
                        controls: line.controls.map((control) => control.name),
                        delta: Math.max(...heights) - Math.min(...heights),
                    };
                })
                .filter((line) => line.delta > 2),
        };
    });

    expect(
        report.mainScrollWidth,
        `${label}: screen body width ${report.mainScrollWidth}px exceeds ${report.mainClientWidth}px`,
    ).toBeLessThanOrEqual(report.mainClientWidth + 1);
    expect(
        report.unevenLines,
        `${label}: controls sharing a line differ in height by more than 2px`,
    ).toEqual([]);
}

async function listedAddresses(page) {
    return page.getByRole('button', { name: /^View address / }).evaluateAll((buttons) => (
        buttons.map((button) => button.getAttribute('aria-label')?.replace(/^View address /, ''))
            .filter(Boolean)
    ));
}

for (const viewport of VIEWPORTS) {
    test(`address preferences flow renders at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.slow();
        let generatedAddress;
        await page.setViewportSize(viewport);
        // A created wallet, not the demo one: a demo wallet keeps every compose
        // submit disabled behind its demo note, so it can never reach a review.
        await createWallet(page);

        await test.step('add an address from the populated address list', async () => {
            await gotoPalette(page, 'Addresses');
            await expectScreenLayout(page, 'Addresses', 'initial address list');
            const before = new Set(await listedAddresses(page));
            expect(before.size, 'the new wallet holds no address').toBeGreaterThan(0);

            await page.getByRole('button', { name: 'Add or import address' }).click();
            await expectScreenLayout(page, 'Addresses', 'open add-address menu');
            await page.getByRole('menuitem', { name: 'Add address' }).click();
            await expectScreenLayout(page, 'Add addresses', 'add-address form');
            await page.getByTestId('add-address-generate').click();

            await expectScreenLayout(page, 'Addresses', 'address list after generation');
            await expect(page.getByRole('button', { name: /^View address / }))
                .toHaveCount(before.size + 1);
            const after = await listedAddresses(page);
            generatedAddress = after.find((address) => !before.has(address));
            expect(
                generatedAddress,
                'generation did not add a distinct address row',
            ).toBeTruthy();
        });

        await test.step('label the new address and open its preferences', async () => {
            await page.getByRole('button', {
                name: `View address ${generatedAddress}`,
            }).click();
            await expectScreenLayout(page, 'View address', 'address detail');

            const label = page.getByRole('textbox', { name: 'Address label' });
            const save = page.getByRole('button', { name: 'Save', exact: true });
            await label.fill(LABEL);
            await save.click();
            await expect(save).toBeDisabled();
            await expect(label).toHaveValue(LABEL);
            await expectScreenLayout(page, 'View address', 'labelled address detail');

            await page.getByRole('button', { name: 'Edit on-chain preferences' }).click();
            await expectScreenLayout(page, 'On-chain preferences', 'preferences form');
        });

        await test.step('review changed preferences from the top with exact values', async () => {
            const main = page.getByRole('main');
            await main.getByRole('radio', { name: 'Destroy the fee (reduces supply)' }).check();
            await main.getByRole('checkbox', {
                name: 'Require a memo on any send to this address',
            }).check();
            await main.getByRole('radio', {
                name: 'Anyone may open a dispenser funded by this address',
            }).check();
            await main.getByLabel('Memo (optional)').fill(MEMO);
            await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
            await main.getByRole('button', { name: 'Review', exact: true }).click();

            await expectScreenLayout(page, 'Review preferences', 'preferences review');
            expect(
                await main.evaluate((element) => element.scrollTop),
                'preferences review did not open at the top',
            ).toBeLessThanOrEqual(1);

            const review = main.getByRole('form', { name: 'Review preferences' });
            // AddressText middle-truncates on screen and carries the full address
            // as its accessible name.
            await expect(review.getByLabel(generatedAddress, { exact: true })).toBeVisible();
            await expect(review).toContainText('Destroy the fee (reduces supply) - CHANGED');
            await expect(review).toContainText('Memo required on incoming sends - CHANGED');
            await expect(review).toContainText('Anyone may open a dispenser here - CHANGED');
            await expect(review).toContainText(MEMO);
        });

        await test.step('mark the labelled address active through Use', async () => {
            await page.getByRole('button', { name: 'Back to previous screen' }).click();
            await expectScreenLayout(page, 'On-chain preferences', 'preferences after review');
            await page.getByRole('button', { name: 'Back to previous screen' }).click();
            await expectScreenLayout(page, 'Addresses', 'address list after preferences');

            const row = page.getByRole('button', {
                name: `View address ${generatedAddress}`,
            });
            await expect(row).toContainText(LABEL);
            await row.click();
            await expectScreenLayout(page, 'View address', 'address detail before Use');
            const use = page.getByRole('button', { name: 'Use', exact: true });
            await expect(use).toHaveAttribute('title', 'Make this the active address');
            await use.click();
            await expect(use).toBeHidden();
            // Use returns to Home by design; let Home finish mounting before
            // the palette opens, or the palette is torn down mid-fill.
            await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
            await settle(page);

            await gotoPalette(page, 'Addresses');
            await page.getByRole('button', {
                name: `View address ${generatedAddress}`,
            }).click();
            await expect(page.getByRole('main').getByText('Active', { exact: true }))
                .toBeVisible();
            await expect(page.getByRole('button', { name: 'Use', exact: true })).toHaveCount(0);
            await expectScreenLayout(page, 'View address', 'active address detail');
        });
    });
}
