// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { selectNamedToken } from '../../fixtures/crossChain.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { width: 320, height: 640 },
    { width: 360, height: 800 },
    { width: 400, height: 800 },
    { width: 1280, height: 800 },
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function fieldMetrics(input, actionNames) {
    return input.evaluate((element, names) => {
        const findAction = (root, name) => [...root.querySelectorAll('button')]
            .find((button) => button.getAttribute('aria-label') === name);
        let field = element.parentElement;
        while (field && !names.every((name) => findAction(field, name))) {
            field = field.parentElement;
        }
        if (!field) throw new Error(`No field contains actions: ${names.join(', ')}`);

        const inputBox = element.getBoundingClientRect();
        const inputStyle = getComputedStyle(element);
        const pixels = (value) => Number.parseFloat(value) || 0;

        return {
            controlHeight: inputBox.height,
            inputTextWidth: element.clientWidth
                - pixels(inputStyle.paddingLeft)
                - pixels(inputStyle.paddingRight),
            actions: names.map((name) => {
                const button = findAction(field, name);
                const box = button.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(button);
                const lineTops = new Set([...range.getClientRects()]
                    .filter((rect) => rect.width > 0 && rect.height > 0)
                    // An icon and its label can sit a sub-pixel apart on one line.
                    .map((rect) => Math.round(rect.top)));
                return {
                    name,
                    text: (button.textContent || '').trim(),
                    height: box.height,
                    clientWidth: button.clientWidth,
                    scrollWidth: button.scrollWidth,
                    lineCount: lineTops.size,
                    centreOffset: Math.abs((box.top - inputBox.top) - (inputBox.bottom - box.bottom)),
                    inside: box.left >= inputBox.left - 1
                        && box.right <= inputBox.right + 1
                        && box.top >= inputBox.top - 1
                        && box.bottom <= inputBox.bottom + 1,
                };
            }),
        };
    }, actionNames);
}

async function expectTrailingActionsFit(input, label, actionNames) {
    await expect(input, `${label}: input is not visible`).toBeVisible();
    const metrics = await fieldMetrics(input, actionNames);
    const diagnostic = JSON.stringify(metrics, null, 2);

    expect(
        metrics.inputTextWidth,
        `${label}: input has less than 120px for text\n${diagnostic}`,
    ).toBeGreaterThanOrEqual(120);

    for (const action of metrics.actions) {
        expect(
            action.lineCount,
            `${label}: ${action.text} wraps onto multiple lines\n${diagnostic}`,
        ).toBe(1);
        // The actions sit inset inside the field border, so they are a little
        // shorter than the control and centred on it.
        expect(
            action.height,
            `${label}: ${action.text} is taller than the field control\n${diagnostic}`,
        ).toBeLessThanOrEqual(metrics.controlHeight);
        expect(
            action.height,
            `${label}: ${action.text} is too short to read as a control\n${diagnostic}`,
        ).toBeGreaterThanOrEqual(24);
        expect(
            action.centreOffset,
            `${label}: ${action.text} is not centred in the field\n${diagnostic}`,
        ).toBeLessThanOrEqual(2);
        expect(
            action.scrollWidth,
            `${label}: ${action.text} is horizontally clipped\n${diagnostic}`,
        ).toBeLessThanOrEqual(action.clientWidth);
        expect(
            action.inside,
            `${label}: ${action.text} leaves the field bounds\n${diagnostic}`,
        ).toBe(true);
    }
}

async function openPaletteRoute(page, name) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(name);
    await palette.getByRole('option', { name: new RegExp(`^${name}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

async function selectBitcoinMainnet(page) {
    const main = page.getByRole('main');
    const trigger = main.getByRole('button', { name: /^Give and get chain:/ });
    await expect(trigger).toBeVisible();
    if (await trigger.getAttribute('aria-label') === 'Give and get chain: Bitcoin') return;

    await trigger.click();
    await main.getByRole('option', { name: /^Bitcoin\s*BTC$/ }).click();
    await expect(trigger).toHaveAttribute('aria-label', 'Give and get chain: Bitcoin');
}

async function checkViewports(page, surface, fields) {
    for (const viewport of VIEWPORTS) {
        await test.step(`${surface} at ${viewport.width}x${viewport.height}`, async () => {
            await page.setViewportSize(viewport);
            await settle(page);
            for (const field of fields) {
                await expectTrailingActionsFit(
                    field.input,
                    `${surface} ${field.name} at ${viewport.width}x${viewport.height}`,
                    field.actions,
                );
            }
        });
    }
}

test('Paste and Max stay inside their fields without squeezing input text', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    await gotoSection(page, 'Send');
    let main = page.getByRole('main');
    await checkViewports(page, 'Send', [
        {
            name: 'To',
            input: main.getByLabel('To', { exact: true }),
            actions: ['Paste from clipboard'],
        },
        {
            name: 'Amount',
            input: main.getByRole('textbox', { name: /^Amount/ }),
            actions: ['Paste from clipboard', 'Use max available amount'],
        },
    ]);

    await openPaletteRoute(page, 'Swap');
    await selectBitcoinMainnet(page);
    await selectNamedToken(page, 'Give token', {
        chainId: 'bitcoin-mainnet',
        chainLabel: 'Bitcoin',
        tick: 'PEPECASH',
    });
    main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Use max available amount' })).toBeVisible();
    await checkViewports(page, 'Swap', [
        {
            name: 'Give amount',
            input: main.getByRole('textbox', { name: /^Give amount/ }),
            actions: ['Paste from clipboard', 'Use max available amount'],
        },
    ]);

    await gotoSection(page, 'Receive');
    main = page.getByRole('main');
    await checkViewports(page, 'Receive', [
        {
            name: 'Amount',
            input: main.getByRole('textbox', { name: /^Amount/ }),
            actions: ['Paste from clipboard'],
        },
    ]);
});
