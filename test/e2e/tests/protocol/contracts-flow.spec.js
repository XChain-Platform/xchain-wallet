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
import {
    describeOffenders,
    documentOverflow,
    enterDemoWallet,
    overflowingElements,
} from '../../fixtures/responsive.js';

const CONTRACT_INDEX = '4242';
const CONTRACT_NAME = 'E2E Escrow';
const CONTRACT_LABEL = `${CONTRACT_NAME} v1.2.3 (C:BTC:${CONTRACT_INDEX})`;
const CALL_AMOUNT = '12.50000000';
const DEPOSIT_AMOUNT = '1.25';
const DEPOSIT_TICK = 'EXAMPLE';
const DEPLOY_GAS = '250000';
const DEPLOY_SOURCE = [
    'module.exports = {',
    "  meta: { name: 'Review Contract', description: 'Exercises the publish review.', version: '1.0.0' },",
    '  release: function(amount) { return amount; }',
    '};',
].join('\n');

const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

async function installContractFixture(page) {
    await page.route('**/src/messaging.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const original = `    const { sendMessage: sendToHost } = await loadHostBridge();
    return sendToHost(type, request);`;
        const replacement = `    const fixtureContract = {
        action_index: ${CONTRACT_INDEX},
        source: 'bc1qfixtureowner000000000000000000000000000',
        meta_name: '${CONTRACT_NAME}',
        meta_description: 'Deterministic contract fixture for the browser flow.',
        meta_version: '1.2.3',
        block_index: 840000,
        gas_limit: '175000',
        status: 'Active',
        code_hash: '${'ab'.repeat(32)}',
        owner_withdraw: false,
        abi: {
            version: 1,
            methods: {
                release: {
                    summary: 'Release an exact amount.',
                    params: [{ name: 'amount', type: 'amount' }],
                },
            },
        },
    };
    // The demo wallet's Bitcoin chain.
    const onFixtureChain = request?.chainId === 'bitcoin-regtest';
    if (type === 'contracts.forSource' || type === 'contracts.browseAll') {
        return onFixtureChain ? [fixtureContract] : [];
    }
    if (type === 'deposits.forAddress' || type === 'withdrawals.forAddress') return [];
    if (type === 'contracts.byActionIndex') return onFixtureChain ? fixtureContract : null;
    if (type === 'actions.byIndex') {
        return { action_index: ${CONTRACT_INDEX}, params: { GAS_LIMIT: '175000' } };
    }
    if (type === 'contracts.state') return { released: '${CALL_AMOUNT}' };
    if (type === 'contracts.balance') return { EXAMPLE: '500' };
    if (type === 'executions.forContract') return [];
    if (type === 'contracts.manifest') return { permissions: [], maxTakeBps: null };
    if (type === 'contracts.getExportedMeta') {
        return {
            status: 'present',
            name: 'Review Contract',
            description: 'Exercises the publish review.',
            version: '1.0.0',
        };
    }
    if (type === 'deploy.plan') {
        return { single: true, totalChunks: 0, codeHash: '${'cd'.repeat(32)}', partLengths: null };
    }
    const { sendMessage: sendToHost } = await loadHostBridge();
    return sendToHost(type, request);`;

        expect(source, 'the web messaging seam changed').toContain(original);
        await route.fulfill({ response, body: source.replace(original, replacement) });
    });
}

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function mismatchedControlRows(page) {
    return page.getByRole('main').evaluate((main) => {
        // Skip aria-hidden subtrees: decoration such as the fee slider tick labels, not controls.
        const controls = Array.from(Array.from(main.querySelectorAll([
            'button',
            'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])',
            'select',
            'textarea',
            '[role="tab"]',
        ].join(','))).filter((el) => !el.closest('[aria-hidden="true"]'))).filter((control) => {
            const rect = control.getBoundingClientRect();
            const style = getComputedStyle(control);
            return rect.width > 0 && rect.height > 0
                && style.display !== 'none' && style.visibility !== 'hidden';
        });

        const rows = new Map();
        for (const control of controls) {
            let row = control.parentElement;
            while (row && row !== main) {
                const style = getComputedStyle(row);
                const horizontalFlex = style.display.includes('flex')
                    && style.flexDirection.startsWith('row');
                if (horizontalFlex || style.display.includes('grid')) break;
                row = row.parentElement;
            }
            if (!row || row === main) continue;
            const entries = rows.get(row) || [];
            entries.push(control);
            rows.set(row, entries);
        }

        const failures = [];
        for (const entries of rows.values()) {
            const lines = [];
            for (const control of entries) {
                const rect = control.getBoundingClientRect();
                let line = lines.find((candidate) => Math.abs(candidate.top - rect.top) <= 2);
                if (!line) {
                    line = { top: rect.top, controls: [] };
                    lines.push(line);
                }
                line.controls.push({
                    height: rect.height,
                    label: control.getAttribute('aria-label')
                        || control.textContent?.trim()
                        || control.getAttribute('name')
                        || control.tagName.toLowerCase(),
                });
            }
            for (const line of lines.filter((candidate) => candidate.controls.length > 1)) {
                const heights = line.controls.map((control) => control.height);
                if (Math.max(...heights) - Math.min(...heights) > 2) failures.push(line.controls);
            }
        }
        return failures;
    });
}

async function expectScreen(page, viewport, heading) {
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    await settle(page);

    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${viewport.name} ${heading}: elements paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${viewport.name} ${heading}: document width ${scrollWidth}px exceeds ${clientWidth}px`,
    ).toBeLessThanOrEqual(clientWidth + 1);

    expect(
        await mismatchedControlRows(page),
        `${viewport.name} ${heading}: controls sharing a row differ in height by more than 2px`,
    ).toEqual([]);
}

async function expectReviewAtTop(page, viewport, heading) {
    await expectScreen(page, viewport, heading);
    const scrollTop = await page.getByRole('main').evaluate((main) => main.scrollTop);
    expect(scrollTop, `${viewport.name} ${heading}: review did not open at the top`).toBeLessThanOrEqual(1);
}

function definitionValue(main, term) {
    return main.locator('dt').filter({ hasText: new RegExp(`^${term}$`) })
        .locator('xpath=following-sibling::dd[1]');
}

async function setWatcherMode(page) {
    await gotoSection(page, 'Settings');
    await page.getByRole('button', { name: /^Wallet mode/ }).click();
    const watcher = page.getByRole('radio', { name: /^Watcher/ });
    await expect(watcher).toBeVisible();
    await watcher.click();
    const confirm = page.getByRole('button', { name: 'Confirm mode change' });
    if (await confirm.count() > 0) {
        await confirm.click();
        await expect(confirm).toBeHidden();
    }
    await expect(watcher).toBeChecked();
}

async function openContract(page) {
    await gotoSection(page, 'Contracts');
    const row = page.getByRole('button', { name: `Open ${CONTRACT_LABEL}`, exact: true }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByRole('heading', { name: CONTRACT_LABEL, exact: true })).toBeVisible();
}

async function walkExecute(page, viewport) {
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Call method', exact: true }).click();
    await expectScreen(page, viewport, `Call contract #${CONTRACT_INDEX}`);

    await main.getByLabel('amount (amount)', { exact: true }).fill(CALL_AMOUNT);
    await main.getByRole('button', { name: /^Deposit \(optional\):/ }).click();
    await expectScreen(page, viewport, 'Token to deposit');
    await main.getByLabel('Search coins or tokens').fill(DEPOSIT_TICK);
    await main.locator(`[data-balance-key="bitcoin-regtest:${DEPOSIT_TICK}"]`).first().click();
    await main.getByRole('textbox', { name: /^Deposit amount/ }).fill(DEPOSIT_AMOUNT);

    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await main.getByRole('button', { name: 'Preview', exact: true }).click();
    await expectReviewAtTop(page, viewport, 'Review contract call');
    await expect(definitionValue(main, 'Contract')).toHaveText(`#${CONTRACT_INDEX}`);
    await expect(definitionValue(main, 'Deposit')).toHaveText(`${DEPOSIT_AMOUNT} ${DEPOSIT_TICK}`);
    await expect(definitionValue(main, 'Method')).toHaveText('release');
    await expect(definitionValue(main, 'Params')).toContainText(CALL_AMOUNT);

    await page.getByRole('button', { name: 'Back to previous screen' }).click();
    await expect(page.getByRole('heading', { name: `Call contract #${CONTRACT_INDEX}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to previous screen' }).click();
    await expect(page.getByRole('heading', { name: 'Contract detail', exact: true })).toBeVisible();
}

async function walkDeploy(page, viewport) {
    await page.getByRole('button', { name: 'Back to contracts list' }).click();
    const main = page.getByRole('main');
    await main.getByRole('button', { name: '+ Publish contract', exact: true }).click();
    await expectScreen(page, viewport, 'Publish contract on Bitcoin');

    await main.getByLabel('Code source', { exact: true }).fill(DEPLOY_SOURCE);
    await main.getByLabel('Gas limit', { exact: true }).fill(DEPLOY_GAS);
    await main.getByLabel('Constructor params (optional)', { exact: true }).fill(CALL_AMOUNT);
    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await main.getByRole('button', { name: 'Preview', exact: true }).click();

    await expectReviewAtTop(page, viewport, 'Review publish');
    await expect(definitionValue(main, 'Name')).toHaveText('Review Contract');
    await expect(definitionValue(main, 'Gas limit')).toHaveText(DEPLOY_GAS);
    await expect(definitionValue(main, 'Constructor')).toHaveText(CALL_AMOUNT);

    await page.getByRole('button', { name: 'Back to previous screen' }).click();
    await expect(page.getByRole('heading', { name: 'Publish contract on Bitcoin', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to previous screen' }).click();
    await expect(page.getByRole('heading', { name: 'Contracts', exact: true })).toBeVisible();
}

test('contract browse, detail, execute, and deploy reviews fit phone and desktop', async ({ page }) => {
    test.slow();
    await installContractFixture(page);
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await setWatcherMode(page);

    for (const viewport of VIEWPORTS) {
        await test.step(viewport.name, async () => {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await openContract(page);

            await page.getByRole('button', { name: 'Back to contracts list' }).click();
            await expectScreen(page, viewport, 'Contracts');
            await page.getByRole('button', { name: `Open ${CONTRACT_LABEL}`, exact: true }).first().click();
            await expect(page.getByRole('heading', { name: CONTRACT_LABEL, exact: true })).toBeVisible();
            await expectScreen(page, viewport, 'Contract detail');

            await walkExecute(page, viewport);
            await walkDeploy(page, viewport);
        });
    }
});
