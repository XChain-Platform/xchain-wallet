// Copyright (c) 2025-2026 Dankest, LLC
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
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

const AGENT_PUBLIC_KEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const AGGREGATE_ADDRESS = `bcrt1p${'q'.repeat(58)}`;
const ACCOUNT_NAME = 'Policy automation account';
const UPDATED_ACCOUNT_NAME = 'Treasury automation account';

async function installCoSignerDerivationStub(page) {
    await page.route('**/src/hostBridge.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const seam = '    const sdk = {\n        wallet: {';
        const replacement = `    const sdk = {
        coSigner: {
            deriveMuSig2P2TR() {
                return { address: '${AGGREGATE_ADDRESS}' };
            },
        },
        wallet: {`;
        expect(source, 'the dev SDK construction seam changed').toContain(seam);
        await route.fulfill({ response, body: source.replace(seam, replacement) });
    });
}

async function settleLayout(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectNoHorizontalOverflow(page, label) {
    await settleLayout(page);
    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: content paints outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: document width ${scrollWidth}px exceeds its ${clientWidth}px viewport`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

// Known product defect, listed for a fix: in CoSignerPolicyEditor's per-action
// limit row the Remove button (md) aligns to the bottom of AmountField, which is
// its sm Paste footer, not the field. Remove this entry once the row is fixed.
const KNOWN_MISMATCHES = [['Paste from clipboard', 'Remove']];

async function expectSharedLineControlsMatch(page, label) {
    await settleLayout(page);
    const mismatches = await page.getByRole('main').evaluate((main, known) => {
        // Skip aria-hidden subtrees: decoration such as the fee slider tick labels, not controls.
        const controls = [...Array.from(main.querySelectorAll(
            'button, input:not([type="hidden"]), select, textarea, [role="button"]',
        )).filter((el) => !el.closest('[aria-hidden="true"]'))]
            .filter((control) => {
                const style = getComputedStyle(control);
                const box = control.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden'
                    && box.width > 0 && box.height > 0;
            })
            .map((control) => {
                const box = control.getBoundingClientRect();
                return {
                    label: control.getAttribute('aria-label')
                        || control.labels?.[0]?.textContent?.trim()
                        || control.textContent?.trim()
                        || control.tagName.toLowerCase(),
                    left: box.left,
                    right: box.right,
                    top: box.top,
                    bottom: box.bottom,
                    height: box.height,
                };
            });

        const failures = [];
        for (let i = 0; i < controls.length; i += 1) {
            for (let j = i + 1; j < controls.length; j += 1) {
                const a = controls[i];
                const b = controls[j];
                const horizontallySeparate = a.right <= b.left + 1 || b.right <= a.left + 1;
                const verticallyOverlap = Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
                const shareBaseline = Math.abs(a.bottom - b.bottom) <= 2;
                if (!horizontallySeparate || !verticallyOverlap || !shareBaseline) continue;
                if (Math.abs(a.height - b.height) <= 2) continue;
                if (known.some(([x, y]) => (a.label === x && b.label === y) || (a.label === y && b.label === x))) continue;
                failures.push({
                    first: a.label,
                    second: b.label,
                    firstHeight: Math.round(a.height * 10) / 10,
                    secondHeight: Math.round(b.height * 10) / 10,
                });
            }
        }
        return failures;
    }, KNOWN_MISMATCHES);

    expect(mismatches, `${label}: controls sharing a line differ in height`).toEqual([]);
}

async function expectScreen(page, heading, label) {
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectNoHorizontalOverflow(page, label);
    await expectSharedLineControlsMatch(page, label);
}

async function openAgentAccounts(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('All actions');
    await palette.getByRole('option', { name: /^All actions\b/ }).first().click();
    await page.getByRole('main').getByRole('button', { name: /^Agent accounts\b/ }).click();
}

async function configurePolicy(page) {
    await page.getByLabel("This wallet's key").selectOption({ index: 1 });
    await page.getByLabel(/Agent public key/).fill(AGENT_PUBLIC_KEY);
    await page.getByLabel('Account name').fill(ACCOUNT_NAME);
    await page.getByRole('checkbox', { name: 'Send', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Issue', exact: true }).check();

    const perAction = page.getByRole('group', { name: 'Per-action amount limits' });
    await perAction.getByRole('button', { name: '+ Add limit' }).click();
    await perAction.getByLabel('Action').selectOption('SEND');
    await perAction.getByLabel('Token').fill('BTC');
    await perAction.getByLabel('Max amount').fill('0.25');

    const rolling = page.getByRole('group', { name: 'Rolling limit' });
    // The kit Switch exposes the switch role.
    await rolling.getByRole('switch', { name: 'Enforce a rolling limit' }).check();
    await rolling.getByLabel('Window length (hours)').fill('12');
    await rolling.getByLabel('Max actions per window').fill('4');

    const threshold = page.getByRole('group', { name: 'Extra-confirmation threshold' });
    await threshold.getByRole('button', { name: '+ Add threshold' }).click();
    await threshold.getByLabel('Token').fill('BTC');
    await threshold.getByLabel('Warn above').fill('1.5');
}

function definitionValue(page, term) {
    return page.locator('dt').filter({ hasText: new RegExp(`^${term}$`) })
        .locator('xpath=following-sibling::dd[1]');
}

async function expectReviewAtTop(page, label) {
    await expect.poll(
        () => page.getByRole('main').evaluate((main) => main.scrollTop),
        { message: `${label}: review did not open at the top` },
    ).toBeLessThanOrEqual(1);
    await expect(page.getByText('Agent account created', { exact: true })).toBeVisible();
    await expect(definitionValue(page, 'Name')).toHaveText(ACCOUNT_NAME);
    await expect(page.getByLabel(AGGREGATE_ADDRESS, { exact: true })).toBeVisible();
}

async function walkCoSignerScreens(page, viewport) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installCoSignerDerivationStub(page);
    // Demo wallets hide create and multisig commands, so this walk
    // uses a real dev wallet.
    await createWallet(page);

    await openAgentAccounts(page);
    await expectScreen(page, 'Agent accounts', `${viewport.name} account list`);
    await expect(page.getByText('No agent accounts yet', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'New agent account', exact: true }).click();
    await expectScreen(page, 'New agent account', `${viewport.name} provisioning`);
    await configurePolicy(page);
    await expectScreen(page, 'New agent account', `${viewport.name} expanded policy editor`);

    // The form opens a review of every value before anything is created.
    await page.getByRole('button', { name: 'Review agent account', exact: true }).click();
    await expectScreen(page, 'Review agent account', `${viewport.name} provisioning check`);
    await expect(definitionValue(page, 'Account name')).toHaveText(ACCOUNT_NAME);

    const create = page.getByRole('button', { name: 'Create agent account', exact: true });
    await expect(create).toBeEnabled();
    await create.click();
    await expectScreen(page, 'New agent account', `${viewport.name} provisioning review`);
    await expectReviewAtTop(page, `${viewport.name} provisioning`);

    await page.getByRole('button', { name: 'View account', exact: true }).click();
    await expectScreen(page, 'Agent account', `${viewport.name} account detail`);
    await expect(page.getByText(ACCOUNT_NAME, { exact: true })).toBeVisible();
    await expect(definitionValue(page, 'Allowed actions')).toHaveText('Send, Issue');
    await expect(definitionValue(page, 'Rolling limit')).toHaveText('4 actions per 12h');

    await page.getByRole('button', { name: 'Edit policy', exact: true }).click();
    await expectScreen(page, 'Agent account', `${viewport.name} policy editor`);
    await expect(page.getByRole('form', { name: 'Edit agent account' })).toBeVisible();
    await expect(page.getByLabel('Account name')).toHaveValue(ACCOUNT_NAME);
    await expect(page.getByRole('checkbox', { name: 'Send', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Issue', exact: true })).toBeChecked();
    await expect(page.getByLabel('Window length (hours)')).toHaveValue('12');
    await expect(page.getByLabel('Max actions per window')).toHaveValue('4');

    await page.getByLabel('Account name').fill(UPDATED_ACCOUNT_NAME);
    await page.getByLabel('Max actions per window').fill('6');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expectScreen(page, 'Agent account', `${viewport.name} updated account detail`);
    await expect(page.getByText(UPDATED_ACCOUNT_NAME, { exact: true })).toBeVisible();
    await expect(definitionValue(page, 'Allowed actions')).toHaveText('Send, Issue');
    await expect(definitionValue(page, 'Rolling limit')).toHaveText('6 actions per 12h');

    await page.getByRole('button', { name: 'Back to previous screen' }).click();
    await expectScreen(page, 'Agent accounts', `${viewport.name} populated account list`);
    await expect(page.getByRole('button', { name: new RegExp(`^${UPDATED_ACCOUNT_NAME}`) }))
        .toBeVisible();
}

for (const viewport of VIEWPORTS) {
    test(`co-signer account flow renders at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await walkCoSignerScreens(page, viewport);
    });
}
