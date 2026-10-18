// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    expect,
    test,
    createWallet,
} from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    overflowingElements,
} from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { width: 412, height: 869 },
    { width: 1280, height: 800 },
];
// The dev wallet airdrops on Bitcoin, so the recipients are mainnet
// addresses; the batch step below still names its own regtest chain.
const RECIPIENTS = [
    'bc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5fcj4z3',
    'bc1qlx2eanawq23ujwhdg7txxdfpffzdvmgtw8mmtd',
    'bc1qmr46t4ca5wh35k6mczdzrkepqw2d8ne9u4tttn',
];
const BATCH_RECIPIENTS = [
    'bcrt1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5phstwt',
    'bcrt1qlx2eanawq23ujwhdg7txxdfpffzdvmgtxge98h',
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('combobox').fill(title);
    const option = dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(option, `no palette command matching "${title}"`).toBeVisible();
    await option.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function expectMatchingInlineControlHeights(page, label) {
    const result = await page.getByRole('main').evaluate((main) => {
        // Skip aria-hidden subtrees: decoration such as the fee slider tick labels, not controls.
        const controls = [...Array.from(main.querySelectorAll(
            'button, input:not([type="hidden"]), select, textarea',
        )).filter((el) => !el.closest('[aria-hidden="true"]'))].flatMap((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            if (style.display === 'none' || style.visibility === 'hidden'
                || box.width < 1 || box.height < 1) return [];
            return [{
                name: element.getAttribute('aria-label')
                    || element.labels?.[0]?.textContent?.trim()
                    || element.textContent?.trim()
                    || element.tagName.toLowerCase(),
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                height: box.height,
            }];
        });
        const mismatches = [];

        for (let i = 0; i < controls.length; i += 1) {
            for (let j = i + 1; j < controls.length; j += 1) {
                const a = controls[i];
                const b = controls[j];
                const separateColumns = a.right <= b.left + 1 || b.right <= a.left + 1;
                const verticalOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (!separateColumns || verticalOverlap < Math.min(a.height, b.height) * 0.75) continue;
                const difference = Math.abs(a.height - b.height);
                if (difference > 2) {
                    mismatches.push({
                        controls: [a.name, b.name],
                        heights: [Math.round(a.height), Math.round(b.height)],
                        difference,
                    });
                }
            }
        }
        return { mismatches };
    });

    expect(result.mismatches, `${label}: controls sharing a line differ in height by more than 2px`)
        .toEqual([]);
}

async function expectScreenLayout(page, heading, label) {
    await settle(page);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true }),
        `${label}: screen has no visible heading`).toBeVisible();

    const offenders = await overflowingElements(page);
    expect(offenders, `${label}: content paints outside the viewport\n${describeOffenders(offenders)}`)
        .toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(scrollWidth, `${label}: document scrolls horizontally`)
        .toBeLessThanOrEqual(clientWidth + 1);

    await expectMatchingInlineControlHeights(page, label);
}

async function scrollMainToBottom(page, label) {
    const maximum = await page.getByRole('main').evaluate((main) => {
        main.scrollTop = main.scrollHeight;
        return main.scrollHeight - main.clientHeight;
    });
    expect(maximum, `${label}: the filled form did not become scrollable`).toBeGreaterThan(0);
}

async function expectReviewAtTop(page, label) {
    await settle(page);
    const scrollTop = await page.getByRole('main').evaluate((main) => main.scrollTop);
    expect(scrollTop, `${label}: review retained the compose screen's scroll position`)
        .toBeLessThanOrEqual(1);
}

async function fillAirdrop(page) {
    await gotoPalette(page, 'Airdrop');
    const main = page.getByRole('main');
    await expect(main.getByRole('form', { name: 'Token airdrop' })).toBeVisible({ timeout: 30_000 });

    await main.getByRole('button', { name: /^Token to drop:/ }).click();
    await page.getByLabel('Search coins or tokens').fill('XCHAINGOV');
    // Picker rows are named "Select <token name> on <chain>, <balance>, <value>".
    const token = page.getByRole('button', { name: /^Select XChain Governance on Bitcoin\b/ }).first();
    await expect(token, 'the dev wallet did not expose its XCHAINGOV balance').toBeVisible({ timeout: 30_000 });
    await token.click();

    await main.getByRole('textbox', { name: /^Per-recipient amount/ }).fill('7');
    await main.getByLabel('Recipients').fill(RECIPIENTS.join('\n'));
    await expect(main).toContainText('3 valid addresses');
    await expect(main).toContainText('total ~21 XCHAINGOV');
    return main;
}

async function fillBatch(page) {
    await gotoPalette(page, 'All actions');
    const menu = page.getByRole('main');
    await menu.getByRole('button', { name: /^Batch/ }).click();

    const main = page.getByRole('main');
    const picker = (scope, name) => scope.getByRole('combobox', { name, exact: true });
    const params = (scope) => scope.getByRole('textbox', {
        name: 'Params (JSON object)', exact: true,
    });
    const step = (number) => main.getByRole('region', { name: `Step ${number}`, exact: true });

    await expect(main.getByRole('form', { name: 'Batch composer' })).toBeVisible({ timeout: 30_000 });
    // The Batch composer's Network field is a ChainPicker (a popover listbox),
    // not a native select, so it is driven by its trigger and an option.
    const network = main.getByRole('button', { name: /^Network:/ });
    await expect(network).toBeVisible({ timeout: 30_000 });
    if (!((await network.getAttribute('aria-label')) || '').includes('Bitcoin')) {
        await network.click();
        await main.getByRole('option', { name: /^Bitcoin\b/ }).first().click();
    }
    await expect(network).toHaveAttribute('aria-label', /Bitcoin/);

    const first = step(1);
    await picker(first, 'Action').selectOption('SEND');
    await params(first).fill(JSON.stringify({
        VERSION: '0', TICK: 'XCHAIN', AMOUNT: '2', DESTINATION: BATCH_RECIPIENTS[0],
    }));

    await main.getByRole('button', { name: '+ Add action', exact: true }).click();
    const second = step(2);
    await expect(second).toBeVisible();
    await picker(second, 'Action').selectOption('SEND');
    await params(second).fill(JSON.stringify({
        VERSION: '0', TICK: 'XCHAIN', AMOUNT: '3', DESTINATION: BATCH_RECIPIENTS[1],
    }));
    return main;
}

for (const viewport of VIEWPORTS) {
    test(`airdrop and batch reviews render at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.slow();
        await page.setViewportSize(viewport);
        // Demo wallets hide create and multisig commands, so this walk
        // uses a real dev wallet.
        await createWallet(page);

        await test.step('airdrop compose and review', async () => {
            const main = await fillAirdrop(page);
            const label = `airdrop compose at ${viewport.width}x${viewport.height}`;
            await expectScreenLayout(page, 'Airdrop tokens', label);
            await scrollMainToBottom(page, label);
            await main.getByRole('button', { name: 'Review recipients', exact: true }).click();

            await expect(main.getByRole('form', { name: 'Review recipient list' }))
                .toBeVisible({ timeout: 30_000 });
            await expectReviewAtTop(page, 'airdrop review');
            await expect(main).toContainText(/recipients\s*3\b/i, { useInnerText: true });
            await expect(main.getByText('~21 XCHAINGOV', { exact: true })).toBeVisible();
            await expectScreenLayout(
                page,
                'Review address list',
                `airdrop review at ${viewport.width}x${viewport.height}`,
            );
        });

        // Skipped: the batch review is built by sdk.batch(), which the dev-mock SDK
        // this venue serves does not have, so it always reports it cannot build.
        await test.step.skip('batch compose and review', async () => {
            const main = await fillBatch(page);
            const label = `batch compose at ${viewport.width}x${viewport.height}`;
            await expectScreenLayout(page, 'Batch', label);
            await scrollMainToBottom(page, label);
            await main.getByRole('button', { name: 'Review', exact: true }).click();

            await expect(main.getByText('Batch steps (2)')).toBeVisible({ timeout: 30_000 });
            await expectReviewAtTop(page, 'batch review');
            await expect(main).toContainText(/SEND\|0\|XCHAIN\|2\|/);
            await expect(main).toContainText(/SEND\|0\|XCHAIN\|3\|/);
            await expectScreenLayout(
                page,
                'Review batch',
                `batch review at ${viewport.width}x${viewport.height}`,
            );
        });
    });
}
