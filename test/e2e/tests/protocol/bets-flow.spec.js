// Copyright © 2025-2026 Dankest, LLC
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

const CHAIN = 'bitcoin-mainnet';
const FEED_INDEX = '730010';
const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

// Betting is not a nav destination; it opens from the command palette.
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

async function installBetFixture(page) {
    await page.evaluate(async ({ chain, feedIndex }) => {
        const { __setHostForTests } = await import('/src/hostBridge.js');
        const address = {
            id: 'bets-e2e-address',
            address: 'bc1qbetsfixturewallet000000000000000000000000',
            publicKey: `02${'ab'.repeat(32)}`,
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
            label: 'Demo betting address',
        };
        const feed = {
            action_index: feedIndex,
            source: 'bc1qfixtureoracle0000000000000000000000000',
            label: 'Will the XChain release ship this week?',
            outcomes: 'Yes,No',
            outcome_labels: ['Yes', 'No'],
            tick: 'EXAMPLE',
            fee: '2.5',
            min_amount: '25',
            deadline: Math.floor(Date.now() / 1000) + 86_400,
            expire_at: Math.floor(Date.now() / 1000) + 1_296_000,
            feed_status: 'open',
            pools: [
                { outcome: 0, pool: '150', bet_count: 2 },
                { outcome: 1, pool: '75', bet_count: 1 },
            ],
            timeline: [{ status: 'open', block_index: 910_001 }],
        };
        const bet = {
            action_index: '730011',
            feed_action_index: feedIndex,
            outcome: 0,
            amount: '25',
            tick: 'EXAMPLE',
            bet_status: 'open',
        };

        __setHostForTests({
            async handle({ type, request }) {
                let result = null;
                if (type === 'addresses.byChain') result = { [chain]: [address] };
                if (type === 'addresses.active') result = { [chain]: address };
                // The market token picker reads the wallet's balances; a created
                // wallet holds no EXAMPLE, so the fixture address holds 100.
                if (type === 'balances.wallet') {
                    result = {
                        [chain]: [{
                            address: address.address,
                            label: address.label,
                            addressType: 'p2wpkh',
                            derivationPath: address.derivationPath,
                            balances: {
                                native: { tick: 'BTC', divisibility: 8, quantity: '12345678' },
                                tokens: [{
                                    tick: 'EXAMPLE', displayName: 'Example Token', divisibility: 8, quantity: '10000000000',
                                }],
                            },
                            error: null,
                            errorCode: null,
                            retryAfterSeconds: null,
                        }],
                    };
                }
                if (type === 'settings.get') {
                    result = {
                        walletMode: 'full',
                        activeNetwork: 'mainnet',
                        privacy: { metadataFetchEnabled: false },
                    };
                }
                if (type === 'wallet.signerReady') result = { ready: true };
                if (type === 'wallet.list') result = [];
                if (type === 'bet.feeds') result = { data: [feed] };
                if (type === 'bet.feed') result = feed;
                if (type === 'bet.bets') result = { data: [bet] };
                if (type === 'bet.projectPayout') {
                    result = {
                        payout: '37.5', profit: '12.5', impliedOdds: '1.5',
                    };
                }
                if (type === 'bet.projectFeedCreateFee') {
                    result = {
                        durationSeconds: 1_296_000,
                        days: 15,
                        billableDays: 0,
                        free: true,
                        fee: '0',
                    };
                }
                if (type === 'action.bet.composeForConfirm') {
                    const params = request.params;
                    result = {
                        psbt: 'bets-e2e-psbt',
                        encoding: 'OP_RETURN',
                        actionString: 'BET|0|fixture',
                        version: 0,
                        chainId: chain,
                        networkFeeSats: 1500,
                        betParams: { version: 0, ...params },
                        decoded: {
                            summary: `Open market: ${params.label}`,
                            details: [
                                { label: 'Token', value: params.tick },
                                { label: 'Oracle fee', value: `${params.fee}%` },
                                { label: 'Minimum bet', value: `${params.minAmount} ${params.tick}` },
                            ],
                            warnings: [],
                        },
                    };
                }
                if (type === 'action.preflight') {
                    result = { verdict: 'pass', findings: [], unverified: [] };
                }
                if (type === 'action.inputLiveness') {
                    result = { verdict: 'live', spent: [], unknown: [] };
                }
                if (type === 'action.reserve' || type === 'action.releaseReservation') {
                    result = { ok: true };
                }
                return { ok: true, result };
            },
        });
    }, { chain: CHAIN, feedIndex: FEED_INDEX });
}

async function expectSharedControlHeights(page, label) {
    const rows = await page.getByRole('main').evaluate((main) => {
        // Skip aria-hidden subtrees: decoration such as the fee slider tick labels, not controls.
        const controls = [...Array.from(main.querySelectorAll([
            'button',
            'input:not([type="hidden"])',
            'select',
            'textarea',
            '[role="button"]',
            '[role="radio"]',
        ].join(','))).filter((el) => !el.closest('[aria-hidden="true"]'))]
            .filter((element, index, all) => (
                !all.some((ancestor, ancestorIndex) => (
                    ancestorIndex !== index && ancestor.contains(element)
                ))
            ))
            .map((element) => {
                const box = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                    label: element.getAttribute('aria-label')
                        || element.textContent?.trim().slice(0, 40)
                        || element.tagName.toLowerCase(),
                    top: box.top,
                    left: box.left,
                    right: box.right,
                    bottom: box.bottom,
                    center: box.top + (box.height / 2),
                    height: box.height,
                    visible: box.width > 0 && box.height > 0
                        && style.visibility !== 'hidden' && style.display !== 'none',
                };
            })
            .filter((control) => control.visible)
            // A button drawn inside a field box (the address picker) is part of
            // that field, not a second control on its line.
            .filter((control, _, all) => !all.some((field) => field !== control
                && field.left <= control.left && field.right >= control.right
                && field.top <= control.top && field.bottom >= control.bottom));

        const grouped = [];
        for (const control of controls) {
            const row = grouped.find((candidate) => (
                Math.abs(candidate.top - control.top) <= 2
                || Math.abs(candidate.center - control.center) <= 2
            ));
            if (row) row.controls.push(control);
            else grouped.push({ top: control.top, center: control.center, controls: [control] });
        }
        return grouped.filter((row) => row.controls.length > 1);
    });

    for (const row of rows) {
        const heights = row.controls.map((control) => control.height);
        const delta = Math.max(...heights) - Math.min(...heights);
        expect(
            delta,
            `${label}: controls sharing a line differ by ${delta.toFixed(2)}px: `
                + row.controls.map((control) => `${control.label}=${control.height.toFixed(2)}`).join(', '),
        ).toBeLessThanOrEqual(2);
    }
}

async function expectScreenLayout(page, label) {
    await settle(page);
    // The screen title is the page header's h1, which sits above main.
    await expect(page.getByRole('heading', { level: 1 }).first(), `${label}: no heading`)
        .toBeVisible();

    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: ${offenders.length} element(s) paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: document width ${scrollWidth}px exceeds its ${clientWidth}px viewport`,
    ).toBeLessThanOrEqual(clientWidth + 1);
    await expectSharedControlHeights(page, label);
}

async function openCreateReview(page) {
    await page.getByRole('button', { name: 'Create market', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open a market' })).toBeVisible();

    await page.getByRole('button', { name: /^Token bets are placed in:/ }).click();
    await expect(page.getByRole('heading', { name: 'Token bets are placed in' })).toBeVisible();
    await page.getByRole('button', { name: /^Select Example Token on Bitcoin/ }).click();

    await page.getByLabel('What is being bet on').fill('Will the XChain release ship this week?');
    await page.getByLabel('Outcome 0').fill('Yes');
    await page.getByLabel('Outcome 1').fill('No');
    await page.getByLabel('Betting closes').fill(
        new Date(Date.now() + 86_400_000).toISOString().slice(0, 16),
    );
    await page.getByLabel('Your fee (optional)').fill('2.5');
    await page.getByLabel('Smallest bet allowed (optional)').fill('25');
}

for (const viewport of VIEWPORTS) {
    test(`bets flow renders at ${viewport.width} by ${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // A created wallet, not the demo one: a demo wallet keeps every compose
        // submit disabled behind its demo note, so it can never reach a review.
        await createWallet(page);
        await installBetFixture(page);

        await gotoPalette(page, 'Betting');
        await expect(page.getByRole('button', { name: new RegExp(`^#${FEED_INDEX}\\b`) }))
            .toBeVisible();
        await expectScreenLayout(page, `${viewport.name} bet feeds`);

        await page.getByRole('button', { name: new RegExp(`^#${FEED_INDEX}\\b`) }).click();
        await expect(page.getByRole('heading', { name: 'Will the XChain release ship this week?' }))
            .toBeVisible();
        await expectScreenLayout(page, `${viewport.name} feed detail`);

        await page.getByRole('button', { name: /^Back/ }).click();
        await expect(page.getByRole('heading', { name: 'Betting' })).toBeVisible();
        await openCreateReview(page);
        await expectScreenLayout(page, `${viewport.name} create market`);

        const reviewButton = page.getByRole('button', { name: 'Review market', exact: true });
        await reviewButton.scrollIntoViewIfNeeded();
        await reviewButton.click();
        const confirm = page.getByTestId('confirm-modal');
        await expect(confirm).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Confirm' })).toBeVisible();

        const scroll = await page.getByRole('main').evaluate((main) => ({
            main: main.scrollTop,
            document: document.scrollingElement?.scrollTop || 0,
        }));
        expect(scroll.main, `${viewport.name} review main scroll position`).toBeLessThanOrEqual(1);
        expect(scroll.document, `${viewport.name} review document scroll position`).toBeLessThanOrEqual(1);

        const intent = page.getByTestId('action-intent');
        await expect(intent.getByText('2.5%', { exact: true })).toBeVisible();
        await expect(intent.getByText('25 EXAMPLE', { exact: true })).toBeVisible();
        await expectScreenLayout(page, `${viewport.name} market review`);

        await page.keyboard.press('Escape');
        await expect(page.getByRole('heading', { name: 'Open a market' })).toBeVisible();
        await page.getByRole('button', { name: /^Back/ }).click();
        await expect(page.getByRole('heading', { name: 'Betting' })).toBeVisible();
        await page.getByRole('button', { name: 'My bets', exact: true }).click();
        await expect(page.getByText(`Market #${FEED_INDEX}`, { exact: true })).toBeVisible();
        await expectScreenLayout(page, `${viewport.name} my bets`);
    });
}
