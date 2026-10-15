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

const ORACLE = 'bc1qoraclelayoutrecord000000000000000000000';
const MARKET_TITLE = 'Will the reference launch finish before the quarterly release window closes?';
const TICK = 'ORCLTEST';
const PRICE = '12.34';
const FIAT = 'EUR';
const USAGE_FEE = '0.01';
const MEMO = 'Quarterly reference price';

const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

const MARKET = Object.freeze({
    action_index: '2308',
    source: ORACLE,
    label: MARKET_TITLE,
    outcomes: 'Yes,No',
    tick: 'ORACLELAYOUTTOKEN',
    fee: '1.00',
    deadline: Math.floor(Date.now() / 1000) + 86_400,
    expire_at: Math.floor(Date.now() / 1000) + 1_296_000,
    feed_status: 'open',
    pools: [
        { outcome: 0, pool: '10.00000000', bet_count: 2 },
        { outcome: 1, pool: '5.00000000', bet_count: 1 },
    ],
    timeline: [{ status: 'open', block_index: 4217 }],
});

const RECORD = Object.freeze({
    address: ORACLE,
    total_feeds: 9,
    active_feeds: 2,
    counts: { open: 1, closed: 1, resolved: 5, resolved_void: 1, cancelled: 0, expired: 1 },
    fees_earned: [{ tick: 'ORACLELAYOUTTOKEN', resolves: 4, amount: '0.175' }],
});

/** Supplies deterministic read-only BET data while the real screens and shell render it. */
async function installOracleReads(page) {
    await page.addInitScript(({ market, record }) => {
        globalThis.__xchainOracleE2E = { market, record };
    }, { market: MARKET, record: RECORD });

    await page.route('**/src/messaging.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const original = `    const { sendMessage: sendToHost } = await loadHostBridge();
    return sendToHost(type, request);`;
        const replacement = `    const fixture = globalThis.__xchainOracleE2E;
    if (fixture) {
        // One market on one chain: the console asks every chain's addresses and
        // lists each chain's answer, so answering all of them would triple it.
        if (type === 'bet.feeds') {
            return { data: String(request?.chainId || '').startsWith('bitcoin') ? [fixture.market] : [] };
        }
        if (type === 'bet.feed') return { data: [fixture.market] };
        if (type === 'bet.oracle') return { data: [fixture.record] };
    }
    const { sendMessage: sendToHost } = await loadHostBridge();
    return sendToHost(type, request);`;
        if (!source.includes(original)) {
            throw new Error('The web messaging seam changed; update the oracle read fixture.');
        }
        await route.fulfill({ response, body: source.replace(original, replacement) });
    });
}

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('combobox').fill(title);
    const option = dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(option, `no palette command matching "${title}"`).toBeVisible();
    await option.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function useWatcherMode(page) {
    await gotoPalette(page, 'Settings');
    const row = page.getByRole('main').getByRole('button', { name: /^Wallet mode/i });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const watcher = page.getByRole('radio', { name: /^Watcher/ });
    await expect(watcher).toBeVisible({ timeout: 30_000 });
    await watcher.click();
    const confirm = page.getByRole('dialog', { name: /Switch to Watcher/ });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm mode change' }).click();
    await expect(confirm).toBeHidden({ timeout: 30_000 });
    await expect(watcher).toBeChecked();
}

async function sharedControlRows(page) {
    return page.getByRole('main').evaluate((main) => {
        // Skip aria-hidden subtrees: decoration such as the fee slider tick labels, not controls.
        const controls = [...Array.from(main.querySelectorAll(
            'button, input:not([type="hidden"]), select, textarea, [role="button"]',
        )).filter((el) => !el.closest('[aria-hidden="true"]'))]
            .filter((element) => {
                const style = getComputedStyle(element);
                const box = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden'
                    && box.width > 0 && box.height > 0;
            })
            .map((element) => {
                const box = element.getBoundingClientRect();
                return {
                    top: box.top,
                    left: box.left,
                    right: box.right,
                    bottom: box.bottom,
                    center: box.top + box.height / 2,
                    height: box.height,
                    label: (element.getAttribute('aria-label') || element.textContent || element.tagName)
                        .trim().replace(/\s+/g, ' ').slice(0, 60),
                };
            })
            // A button drawn inside a field box (the address QR picker) is part of
            // that field, not a second control on its line.
            .filter((control, _, all) => !all.some((field) => field !== control
                && field.left <= control.left && field.right >= control.right
                && field.top <= control.top && field.bottom >= control.bottom))
            .sort((a, b) => a.top - b.top);

        const rows = [];
        for (const control of controls) {
            const row = rows.find((candidate) => (
                Math.abs(candidate.top - control.top) <= 2
                || Math.abs(candidate.center - control.center) <= 2
            ));
            if (row) row.controls.push(control);
            else rows.push({ top: control.top, center: control.center, controls: [control] });
        }
        return rows.filter((row) => row.controls.length > 1);
    });
}

async function expectScreenLayout(page, heading, label) {
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    await settle(page);

    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: content paints outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const documentSize = await documentOverflow(page);
    expect(
        documentSize.scrollWidth,
        `${label}: the document scrolls horizontally`,
    ).toBeLessThanOrEqual(documentSize.clientWidth + 1);

    const mainSize = await page.getByRole('main').evaluate((main) => ({
        scrollWidth: main.scrollWidth,
        clientWidth: main.clientWidth,
    }));
    expect(mainSize.scrollWidth, `${label}: main content overflows horizontally`)
        .toBeLessThanOrEqual(mainSize.clientWidth + 1);

    for (const row of await sharedControlRows(page)) {
        const heights = row.controls.map((control) => control.height);
        const delta = Math.max(...heights) - Math.min(...heights);
        const controls = row.controls.map((control) => `${control.label} (${control.height.toFixed(1)}px)`);
        expect(delta, `${label}: controls sharing a line differ in height: ${controls.join(', ')}`)
            .toBeLessThanOrEqual(2);
    }
}

async function expectReviewValue(review, value) {
    await expect(review.getByText(value, { exact: true })).toBeVisible();
}

for (const viewport of VIEWPORTS) {
    test(`oracle flow renders at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installOracleReads(page);
        // Demo wallets hide the create commands, so this walk uses a real dev wallet.
        await createWallet(page);
        await useWatcherMode(page);

        await test.step('oracle console', async () => {
            await gotoPalette(page, 'My markets');
            await expect(page.getByText(MARKET_TITLE, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
            await expectScreenLayout(page, 'My markets', `${viewport.name} oracle console`);
        });

        await test.step('oracle record', async () => {
            await page.getByRole('main').getByRole('button', { name: 'View market' }).click();
            await expect(page.getByRole('heading', { name: MARKET_TITLE, exact: true })).toBeVisible();
            await page.getByRole('main').getByRole('button', { name: ORACLE, exact: true }).click();

            const main = page.getByRole('main');
            await expect(main.getByText('Markets opened', { exact: true })).toBeVisible({ timeout: 30_000 });
            await expect(main.getByText('ORACLELAYOUTTOKEN', { exact: true })).toBeVisible();
            await expectScreenLayout(page, 'Oracle record', `${viewport.name} oracle record`);
        });

        await test.step('oracle form', async () => {
            await gotoPalette(page, 'Publish oracle price');
            const form = page.getByRole('form', { name: 'Publish oracle price' });
            await expect(form).toBeVisible({ timeout: 30_000 });
            await expectScreenLayout(page, 'My oracle', `${viewport.name} oracle form`);

            await form.getByLabel("Token's network").selectOption('LTC');
            await form.getByLabel('Token ticker').fill(TICK);
            await form.getByLabel('Currency').selectOption(FIAT);
            await form.getByLabel(/^Price of one/).fill(PRICE);
            await form.getByLabel('Usage fee (optional)').fill(USAGE_FEE);
            await form.getByLabel('Memo (optional)').fill(MEMO);

            const preview = form.getByRole('button', { name: 'Preview', exact: true });
            await preview.scrollIntoViewIfNeeded();
            const before = await page.getByRole('main').evaluate((main) => main.scrollTop);
            expect(before, `${viewport.name}: the form did not scroll, so review top restoration was not exercised`)
                .toBeGreaterThan(0);
            await preview.click();
        });

        await test.step('oracle review', async () => {
            const review = page.getByRole('form', { name: 'Review price publish' });
            await expect(review).toBeVisible({ timeout: 30_000 });
            await settle(page);

            const scroll = await page.getByRole('main').evaluate((main) => main.scrollTop);
            expect(scroll, `${viewport.name}: oracle review did not open at the top`).toBeLessThanOrEqual(1);
            await expectReviewValue(review, 'LTC:ORCLTEST');
            await expectReviewValue(review, FIAT);
            await expectReviewValue(review, `${PRICE} ${FIAT}`);
            await expectReviewValue(review, `${USAGE_FEE} (1% of a dispenser's projected proceeds)`);
            await expectReviewValue(review, MEMO);
            await expectScreenLayout(page, 'Review price publish', `${viewport.name} oracle review`);
        });
    });
}
