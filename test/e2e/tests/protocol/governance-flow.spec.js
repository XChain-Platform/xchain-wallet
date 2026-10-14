// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    enterDemoWallet,
    overflowingElements,
} from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

const POLL = Object.freeze({
    action_index: 42,
    tick: 'XCP',
    question: 'Fund the community governance portal?',
    options: ['Fund the portal', 'Keep the treasury unchanged'],
    poll_status: 'finalized',
    tally_mode: 'approval',
    weight_mode: 'balance',
    max_selections: 1,
    end_block: 700000,
    winning_option: 0,
});

// The demo wallet runs on Bitcoin regtest, so the delegate is a regtest address.
const DELEGATE_ADDRESS = 'bcrt1qmr46t4ca5wh35k6mczdzrkepqw2d8ne956f48f';
const DEPOSIT = '125.5';
const NORMAL_FEE = '0.000015 BTC (6 sat/vB)';

// Governance is not a nav destination; it opens from the command palette.
async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function installGovernanceFixture(page) {
    await page.evaluate(async ({ poll }) => {
        const messaging = await import('/src/messaging.js');
        const bridge = await import('/src/hostBridge.js');
        const wallets = await messaging.listWallets();
        const walletId = wallets[0]?.id;
        if (!walletId) throw new Error('demo wallet fixture did not create a wallet');

        const [addressesByChain, activeAddresses, currentSettings] = await Promise.all([
            messaging.getAddressesByChain(walletId),
            messaging.getActiveAddresses(walletId),
            messaging.getSettings(),
        ]);
        // The demo wallet runs on Bitcoin regtest.
        const bitcoinAddresses = addressesByChain['bitcoin-regtest'];
        if (!Array.isArray(bitcoinAddresses) || bitcoinAddresses.length === 0) {
            throw new Error('demo wallet fixture did not create a Bitcoin address');
        }
        const fixtureAddresses = { 'bitcoin-regtest': bitcoinAddresses };
        const fixtureActive = { 'bitcoin-regtest': activeAddresses['bitcoin-regtest'] };
        const settings = { ...currentSettings, walletMode: 'watcher' };

        const results = {
            'addresses.byChain': fixtureAddresses,
            'addresses.active': fixtureActive,
            'settings.get': settings,
            'contacts.list': [],
            'indexer.watermark': { chainId: 'bitcoin-regtest', watermark: 699900 },
            'chain.tipBlockTime': { blockTime: 0 },
            'governance.polls': { data: [poll] },
            'governance.poll': { data: [poll] },
            'governance.pollResults': {
                data: [
                    { option_index: 0, total_weight: '987654321', voter_count: 17 },
                    { option_index: 1, total_weight: '123456789', voter_count: 4 },
                ],
            },
            'governance.votes': { data: [] },
        };

        bridge.__setHostForTests({
            async handle({ type }) {
                return { ok: true, result: Object.hasOwn(results, type) ? results[type] : null };
            },
        });
        window.dispatchEvent(new CustomEvent('xc:settings-changed', { detail: settings }));
    }, { poll: POLL });
}

async function expectMatchingControlRows(page, label) {
    const mismatches = await page.getByRole('main').evaluate((main) => {
        const selector = 'button, input:not([type="hidden"]), select, textarea';
        // Skip aria-hidden subtrees: decoration such as the fee slider tick labels, not controls.
        const controls = [...Array.from(main.querySelectorAll(selector)).filter((el) => !el.closest('[aria-hidden="true"]'))].map((element) => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                element,
                box,
                visible: style.display !== 'none' && style.visibility !== 'hidden'
                    && box.width > 0 && box.height > 0,
            };
        }).filter(({ visible }) => visible);
        const failures = [];

        for (let leftIndex = 0; leftIndex < controls.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < controls.length; rightIndex += 1) {
                const left = controls[leftIndex];
                const right = controls[rightIndex];
                const sideBySide = left.box.right <= right.box.left + 1
                    || right.box.right <= left.box.left + 1;
                const sharesLine = Math.abs(left.box.top - right.box.top) <= 2;
                if (!sideBySide || !sharesLine) continue;
                if (Math.abs(left.box.height - right.box.height) <= 2) continue;

                failures.push({
                    left: left.element.getAttribute('aria-label') || left.element.textContent.trim(),
                    leftHeight: Math.round(left.box.height * 10) / 10,
                    right: right.element.getAttribute('aria-label') || right.element.textContent.trim(),
                    rightHeight: Math.round(right.box.height * 10) / 10,
                });
            }
        }
        return failures;
    });

    expect(mismatches, `${label}: controls sharing a line differ in height by more than 2px`)
        .toEqual([]);
}

async function expectScreen(page, label, heading) {
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await settle(page);

    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: ${offenders.length} element(s) paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(scrollWidth, `${label}: document width ${scrollWidth}px exceeds ${clientWidth}px`)
        .toBeLessThanOrEqual(clientWidth + 1);
    await expectMatchingControlRows(page, label);
}

async function chooseGovernanceToken(page) {
    await page.getByRole('main').getByRole('button', { name: /^Governance token:/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Select token' })).toBeVisible();
    await page.getByLabel('Search coins or tokens').fill('XCP');
    await page.getByRole('button', { name: /^Select Counterparty on Bitcoin\b/ }).click();
    await expect(page.getByRole('button', { name: /^Governance token: XCP on Bitcoin\b/ }))
        .toBeVisible();
}

async function expectReviewAtTop(page, heading) {
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await settle(page);
    const scrollTop = await page.getByRole('main').evaluate((main) => main.scrollTop);
    expect(scrollTop, `${heading}: review opens below the top of its scroll container`)
        .toBeLessThanOrEqual(1);
}

async function returnToGovernance(page, formHeading) {
    await page.getByRole('button', { name: 'Back to previous screen' }).click();
    await expect(page.getByRole('heading', { level: 1, name: formHeading })).toBeVisible();
    await page.getByRole('button', { name: 'Back to previous screen' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Governance' })).toBeVisible();
}

for (const viewport of VIEWPORTS) {
    test(`governance flows render and review correctly at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await installGovernanceFixture(page);

        await gotoPalette(page, 'Governance');
        await expect(page.getByRole('button', { name: /Fund the community governance portal/ }))
            .toBeVisible();
        await expectScreen(page, `${viewport.name} poll list`, 'Governance');

        await page.getByRole('button', { name: /Fund the community governance portal/ }).click();
        await expect(page.getByText(POLL.question, { exact: true })).toBeVisible();
        await expect(page.getByText('987654321 weight', { exact: true })).toBeVisible();
        await expectScreen(page, `${viewport.name} poll detail`, 'Poll #42');
        await page.getByRole('button', { name: 'Back to previous screen' }).click();

        await page.getByRole('button', { name: 'Create poll', exact: true }).click();
        await expect(page.getByRole('main').getByRole('button', { name: /^Governance token:/ }))
            .toBeVisible();
        await chooseGovernanceToken(page);
        await page.getByLabel('Question (optional)').fill(POLL.question);
        await page.getByLabel('Option 0').fill(POLL.options[0]);
        await page.getByLabel('Option 1').fill(POLL.options[1]);
        await page.getByLabel('Closes at block').fill('700100');
        await page.getByRole('button', { name: 'Advanced (gates + deposit)' }).click();
        await page.getByLabel('Creation deposit (optional)').fill(DEPOSIT);
        await expectScreen(page, `${viewport.name} create poll`, 'Create poll');
        await page.getByRole('button', { name: 'Preview', exact: true }).click();

        await expectReviewAtTop(page, 'Review poll');
        const pollReview = page.getByRole('form', { name: 'Review poll' });
        await expect(pollReview.getByText(`${DEPOSIT} XCHAIN`, { exact: true })).toBeVisible();
        await expect(pollReview.getByText(NORMAL_FEE, { exact: true })).toBeVisible();
        await expect(pollReview.getByText('XCP', { exact: true })).toBeVisible();
        await expectScreen(page, `${viewport.name} poll review`, 'Review poll');
        await returnToGovernance(page, 'Create poll');

        await page.getByRole('button', { name: 'Delegate votes', exact: true }).click();
        await expect(page.getByRole('main').getByRole('button', { name: /^Governance token:/ }))
            .toBeVisible();
        await chooseGovernanceToken(page);
        await page.getByLabel('Delegate to address').fill(DELEGATE_ADDRESS);
        await expectScreen(page, `${viewport.name} delegate vote`, 'Delegate votes');
        await page.getByRole('button', { name: 'Preview', exact: true }).click();

        await expectReviewAtTop(page, 'Review delegate votes');
        const delegateReview = page.getByRole('form', { name: 'Review delegate votes' });
        await expect(delegateReview.getByText(NORMAL_FEE, { exact: true })).toBeVisible();
        await expect(delegateReview.getByText('XCP', { exact: true })).toBeVisible();
        await expect(delegateReview.getByLabel(DELEGATE_ADDRESS)).toBeVisible();
        await expectScreen(page, `${viewport.name} delegation review`, 'Review delegate votes');
    });
}
