// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    createWallet,
    expect,
    openFormSection,
    test,
} from '../../fixtures/wallet.js';
import { pickFiatCurrency } from '../../fixtures/pickerFields.js';
import { searchTokenPicker } from '../../fixtures/fields.js';
import {
    describeOffenders,
    documentOverflow,
    overflowingElements,
} from '../../fixtures/responsive.js';

const ORACLE = 'bc1qoraclelayoutrecord000000000000000000000';
const MARKET_TITLE = 'Will the reference launch finish before the quarterly release window closes?';
// The dev-mock token search returns no platform hits, so the walk prices a
// token the dev wallet owns on Litecoin, which the picker lists first.
const TICK = 'LITEGEM';
const TICK_NAME = 'Lite Gem';
const PRICE = '12.34';
const FIAT = 'EUR';
// 1% on the Usage fee slider, carried on chain as 0.01.
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
    const dialog = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(dialog, 'the wallet menu is not open').toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('combobox').fill(title);
    const option = dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(option, `no palette command matching "${title}"`).toBeVisible();
    await option.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
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

    // A G128 list-and-detail split bleeds one 8px gutter into main, which
    // clips it; anything wider is a real overflow.
    const mainSize = await page.getByRole('main').evaluate((main) => ({
        scrollWidth: main.scrollWidth,
        clientWidth: main.clientWidth,
        twoPanel: [...main.querySelectorAll('[class*="_twoPanel_"]')]
            .some((el) => el.getBoundingClientRect().width > 0),
    }));
    expect(mainSize.scrollWidth, `${label}: main content overflows horizontally`)
        .toBeLessThanOrEqual(mainSize.clientWidth + 1 + (mainSize.twoPanel ? 8 : 0));

    for (const row of await sharedControlRows(page)) {
        const heights = row.controls.map((control) => control.height);
        const delta = Math.max(...heights) - Math.min(...heights);
        const controls = row.controls.map((control) => `${control.label} (${control.height.toFixed(1)}px)`);
        expect(delta, `${label}: controls sharing a line differ in height: ${controls.join(', ')}`)
            .toBeLessThanOrEqual(2);
    }
}


for (const viewport of VIEWPORTS) {
    test(`oracle flow renders at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installOracleReads(page);
        // Demo wallets hide the create commands, so this walk uses a real dev
        // wallet, created in watch-only mode (the mode is chosen at create).
        await createWallet(page, { walletMode: 'watcher' });

        // My markets is the All list narrowed to markets this wallet created
        // (ruling 2026-11-13). The fixture market belongs to ORACLE, not to
        // this fresh wallet, so the walk reaches it from All.
        await test.step('market list', async () => {
            await gotoPalette(page, 'Prediction markets');
            await expect(page.getByText(MARKET_TITLE, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
            await expectScreenLayout(page, 'Prediction Markets', `${viewport.name} market list`);
        });

        await test.step('oracle record', async () => {
            await page.getByRole('main').locator(`[data-market-index="${MARKET.action_index}"]`).click();
            await expect(page.getByRole('heading', { name: MARKET_TITLE, exact: true })).toBeVisible();
            // The market's oracle sits on its Details tab.
            await page.getByRole('main').getByRole('tab', { name: 'Details' }).click();
            await page.getByRole('main').getByRole('button', { name: ORACLE, exact: true }).click();

            const main = page.getByRole('main');
            // The record opens on Actions (G102); its counts and fees are on Details.
            await expect(main.getByRole('list', { name: 'Oracle actions' })).toBeVisible({ timeout: 30_000 });
            await main.getByRole('tab', { name: 'Details' }).click();
            await expect(main.getByText('Markets opened', { exact: true })).toBeVisible({ timeout: 30_000 });
            await expect(main.getByText('ORACLELAYOUTTOKEN', { exact: true })).toBeVisible();
            await expectScreenLayout(page, 'Oracle Record', `${viewport.name} oracle record`);
        });

        await test.step('oracle form', async () => {
            await gotoPalette(page, 'My oracle');
            const form = page.getByRole('form', { name: 'Publish oracle price' });
            await expect(form).toBeVisible({ timeout: 30_000 });
            await expectScreenLayout(page, 'My Oracle', `${viewport.name} oracle form`);

            // The Network field opens the network picker screen (ruling U59).
            await form.getByRole('button', { name: /^Priced token network:/ }).click();
            const networkPicker = page.getByRole('dialog', { name: 'Priced token network' });
            await networkPicker.getByRole('button', { name: /^Select Litecoin/ }).click();
            await expect(networkPicker).toBeHidden();
            // G122: the Token and Fiat currency fields open picker pages.
            // The picker names a row by the token's display name, so the pick
            // matches Lite Gem and the field then shows its ticker.
            await form.getByRole('button', { name: /^Token:/ }).click();
            await searchTokenPicker(page, TICK);
            // On a phone the open filter covers the list; close it to reach the row.
            await page.getByRole('button', { name: 'Filter coins and tokens', exact: true }).click();
            await page.getByRole('button', { name: new RegExp(`^Select ${TICK_NAME} on `) }).first().click();
            await expect(form.getByRole('button', { name: new RegExp(`^Token: ${TICK} on `) })).toBeVisible();
            await pickFiatCurrency(form, FIAT);
            // Exact or by role: each field's 'About ...' help tip (U57) carries its label too.
            await form.getByRole('textbox', { name: /^Price of one/ }).fill(PRICE);
            // Usage Fee and Memo are closed optional sections.
            await openFormSection(form, 'Usage Fee');
            // The slider steps over named stops: Free, 0.5%, then 1%.
            const fee = form.getByRole('slider', { name: 'Usage fee', exact: true });
            await fee.focus();
            await fee.press('ArrowRight');
            await fee.press('ArrowRight');
            await expect(fee).toHaveAttribute('aria-valuetext', '1 percent');
            await openFormSection(form, 'Memo');
            await form.getByLabel('Memo', { exact: true }).fill(MEMO);

            const preview = form.getByRole('button', { name: 'Publish Price', exact: true });
            await preview.scrollIntoViewIfNeeded();
            const before = await page.getByRole('main').evaluate((main) => main.scrollTop);
            expect(before, `${viewport.name}: the form did not scroll, so review top restoration was not exercised`)
                .toBeGreaterThan(0);
            await preview.click();
        });

        await test.step('oracle review', async () => {
            // The publish reviews on the shared Confirm page (G127).
            const review = page.getByTestId('confirm-modal');
            await expect(review).toBeVisible({ timeout: 30_000 });
            await settle(page);

            const scroll = await page.getByRole('main').evaluate((main) => main.scrollTop);
            expect(scroll, `${viewport.name}: oracle review did not open at the top`).toBeLessThanOrEqual(1);
            await expect(review).toContainText(`Publish oracle price 1 ${TICK} = ${PRICE} ${FIAT}`);
            for (const value of [`LTC:${TICK}`, `${PRICE} ${FIAT}`, `${USAGE_FEE} (1% of a dispenser's projected proceeds)`, MEMO]) {
                await expect(review).toContainText(value);
            }
            await expectScreenLayout(page, 'Confirm', `${viewport.name} oracle review`);
        });
    });
}
