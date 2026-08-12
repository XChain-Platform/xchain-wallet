// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// P8: the oracle track record, rendered against a LIVE explorer.
//
// This is the last unverified leg of the betting spec. OracleRecord has 12 unit
// tests and a shell-wiring smoke, but every one of them answers the host from a
// mock: the wallet suite mocks the SDK and the SDK suite mocks the ExplorerClient,
// so the seam between them is exactly where this route's data path was found
// EMPTY once already (XChainSDK carried no proxy for the four BET reads while
// explorer.js had them since P5, and every betting read in the wallet threw at
// runtime while both suites stayed green).
//
// So this spec deliberately proves the thing a mock cannot: that a production
// build of the wallet, talking to the real explorer over the real SDK, renders a
// real oracle's record. It needs no funding and signs nothing, which is why it is
// read-only and fast next to the round trip alongside it.
//
// THREE THINGS ARE DELIBERATE HERE:
//
// 1. THE FIXTURE COMES FROM THE CHAIN, NOT FROM A CONSTANT. The spec asks the
//    explorer which markets exist and picks one, preferring an oracle that has
//    actually been PAID, because a zero-fee oracle would let the fees-earned
//    assertion pass while rendering nothing. A hard-coded feed index would rot
//    the first time this shared chain is wiped (it has been, twice).
//
// 2. ASSERTIONS ARE CROSS-CHECKED AGAINST THE EXPLORER, not merely "some number
//    appeared". The screen agreeing with itself proves nothing; the screen
//    agreeing with `/api/oracle/{address}` is the actual contract, and it is what
//    catches a renderer that reads the wrong field off a correct payload.
//
// 3. THE CAVEAT IS ASSERTED AS PRODUCT, NOT DECORATION. Spec §5 requires this
//    page to say the record is unbonded and per-address. A reputation screen
//    WITHOUT that sentence actively misleads, so its absence is a defect of the
//    same class as a wrong number.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import { EXPLORER_URL, REGTEST_COIN, switchToRegtest } from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * Normalize an explorer payload to a list of records.
 *
 * The two shapes are NOT interchangeable and assuming they were is what made the
 * first run of this spec skip itself: the paged endpoints (`bet_feeds`, `bets`)
 * answer `{ data: [...] }`, but `/oracle/{address}` returns ONE record at the top
 * level with no wrapper, so a data-only unwrap yields nothing, `pickFixture`
 * returns null, and `test.skip` fires. A skipped test reports green, which is the
 * worst possible way to be wrong about a verification.
 */
function rows(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.data)) return payload.data;
    if (payload.data && typeof payload.data === 'object') return [payload.data];
    // Bare single record (the oracle endpoint). `runtime` is the explorer's
    // per-response timing field and is present on every envelope, so it is not a
    // record marker; key off the record's own identity field instead.
    if (typeof payload === 'object' && typeof payload.address === 'string') return [payload];
    return [];
}

/**
 * Pick a market whose oracle is worth rendering.
 *
 * Preference order is deliberate: an oracle that has been PAID exercises the
 * fees-earned branch that a later change added, which is the newest and least-covered
 * code on the page. Falling back to any market at all keeps the spec runnable on
 * a freshly wiped chain, where it still covers counts, the market list and the
 * caveat.
 */
async function pickFixture() {
    const markets = rows(await explorerJson('bet_feeds?limit=100'));
    if (markets.length === 0) return null;

    // Newest first: the most recently created markets are the ones a wiped chain
    // will still have.
    markets.sort((a, b) => Number(b.action_index || 0) - Number(a.action_index || 0));

    let fallback = null;
    for (const m of markets) {
        if (!m.source) continue;
        const record = rows(await explorerJson(`oracle/${m.source}`))[0];
        if (!record) continue;
        if (!fallback) fallback = { market: m, record };
        if (Array.isArray(record.fees_earned) && record.fees_earned.length > 0) {
            return { market: m, record };
        }
    }
    // Markets exist but not one of them yielded a readable oracle record: that is
    // the endpoint being broken, NOT a bare chain, so fail loudly instead of
    // skipping. Only a genuinely market-less chain is allowed to skip below.
    if (!fallback) {
        throw new Error(
            `${markets.length} BET markets on chain but /api/oracle/{address} yielded no readable record ` +
            `for any of their sources - the oracle endpoint or its payload shape has changed`,
        );
    }
    return fallback;
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const combobox = page.getByRole('combobox').first();
    await expect(combobox).toBeVisible();
    await combobox.fill(title);
    await page.keyboard.press('Enter');
}

test.describe('BET oracle record against a live explorer', () => {
    test.use({ actionTimeout: 30_000 });

    // Onboarding plus a production build, on a venue that is routinely shared
    // with another suite. No chain writes, so this is far below the round trip's
    // budget, but the decode pipeline can still be minutes behind on a busy box.
    test.setTimeout(600_000);

    test('renders a real oracle track record, cross-checked against the explorer', async ({ page }) => {
        const fixture = await pickFixture();
        test.skip(!fixture, 'no BET markets on this regtest chain to read an oracle from');

        const { market, record } = fixture;
        const oracle = market.source;
        const feedIndex = String(market.action_index);
        const fees = Array.isArray(record.fees_earned) ? record.fees_earned : [];

        await test.step('onboard onto regtest', async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);
        });

        await test.step('open the market this oracle runs', async () => {
            await gotoPalette(page, 'Betting');
            await expect(page.getByRole('button', { name: 'Create market', exact: true }))
                .toBeVisible({ timeout: 60_000 });

            // The list defaults to markets still taking bets; the fixture is
            // whatever the chain has, which is usually settled by now.
            await page.getByRole('button', { name: 'All markets', exact: true }).click();

            const main = page.getByRole('main');
            const row = main.getByRole('button', { name: new RegExp(`#${feedIndex}\\b`) }).first();
            await expect(row, `market #${feedIndex} is listed`).toBeVisible({ timeout: 60_000 });
            await row.click();

            await expect(main.getByText(`#${feedIndex}`, { exact: false }).first()).toBeVisible();
        });

        await test.step('follow the oracle link into the record', async () => {
            const main = page.getByRole('main');
            // The market page renders the feed source as a link ONLY when the
            // shell passes onOpenOracle. That prop shipped once with no caller at
            // all, so this click is the reachability assertion, not navigation
            // convenience.
            const link = main.getByRole('link', { name: oracle });
            await expect(link, 'the market page links to its oracle').toBeVisible({ timeout: 30_000 });
            await link.click();

            // The route's title lives in PageHeader, which renders OUTSIDE the main
            // region and not as a heading role, so arrival is asserted on the
            // record's own first row instead.
            await expect(page.getByRole('main').getByText('Markets opened', { exact: true }))
                .toBeVisible({ timeout: 30_000 });
        });

        await test.step('the numbers on screen match the explorer', async () => {
            const main = page.getByRole('main');
            await expect(main.getByText(oracle, { exact: false }).first()).toBeVisible();

            // Cross-checks, not existence checks. Each pairs a label the route
            // renders with the field the API served.
            const counts = record.counts || {};
            const pairs = [
                ['Markets opened', record.total_feeds],
                ['Still running', record.active_feeds],
                ['Settled with a result', counts.resolved],
                ['Left to expire with no result', counts.expired],
            ];
            // Read the counts card ONCE and match label-adjacent-to-value on its
            // text. Two DOM facts make per-element locators brittle here and both
            // cost a run to learn: some labels carry an inline "(everyone
            // refunded)" hint, so their element text is not the bare label and an
            // exact match finds nothing; and a `div` filtered by a label also
            // matches the whole card, whose text contains every number, so a
            // contains-check there would pass whatever was rendered.
            //
            // `[^0-9]*` is the real assertion: it allows the hint text between a
            // label and its number but NOT another digit, so a value landing on
            // the wrong row still fails.
            const card = main.locator('div').filter({ hasText: 'Markets opened' }).first();
            const cardText = (await card.innerText()).replace(/\s+/g, ' ');
            for (const [label, expected] of pairs) {
                const want = String(Number(expected || 0));
                expect(cardText, `${label} reads ${want} as the explorer says`)
                    .toMatch(new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^0-9]*${want}`));
            }
        });

        await test.step('fees earned render per wager token', async () => {
            const main = page.getByRole('main');
            if (fees.length === 0) {
                await expect(main.getByText(/never been paid a fee/i)).toBeVisible();
                return;
            }
            // that identity filter is what makes this number the oracle's OWN
            // income rather than every credit it ever received, so asserting the
            // exact figure is asserting that filter end to end.
            for (const f of fees) {
                await expect(main.getByText(String(f.tick), { exact: false }).first()).toBeVisible();
                await expect(main.getByText(String(f.amount), { exact: false }).first()).toBeVisible();
            }
        });

        await test.step('the trust caveat is on the page', async () => {
            const main = page.getByRole('main');
            // Spec §5: an empty history means unknown, not safe. Required copy.
            await expect(main.getByText(/not a guarantee/i)).toBeVisible();
            await expect(main.getByText(/anyone can start again from a new one/i)).toBeVisible();
        });

        await test.step("the oracle's own markets are listed", async () => {
            const main = page.getByRole('main');
            await expect(main.getByRole('heading', { name: 'Their markets' })).toBeVisible();
            // The record page reached this list through getBetFeeds(address,
            // 'source'), a different query from the one that populated the market
            // browser, so this also proves that passthrough works live.
            await expect(main.getByRole('button', { name: new RegExp(`#${feedIndex}\\b`) }).first())
                .toBeVisible({ timeout: 30_000 });
        });
    });
});
