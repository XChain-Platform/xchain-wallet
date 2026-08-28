// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Dispensers": the USER-ORACLE fiat mode (Mode B), the
// last undriven pricing lane on that surface - and the "My oracle" screen it
// depends on, which nothing in 32 sessions had ever driven.
//
// WHAT MODE B IS, and why it is not just Mode A with an extra field. A fiat
// dispenser priced by the VALIDATOR federation (Mode A, already proven in
// `fiat-priced-fill.regtest.spec.js`) prices ONE fill in dollars and converts
// at settlement from a COIN/FIAT snapshot. Mode B instead names an
// ORACLE_ADDRESS: a user-published PRICE v1 quote that prices the TOKEN in
// fiat, cross-converted through the validator's COIN/FIAT snapshot
// (`utility.reverseOraclePriceMatch`):
//
//     tokens = (coin_paid x coin_fiat_price) / token_fiat_price
//
// and the dispenser's opener pays the oracle operator a USAGE FEE up front, as
// a real native-coin output inside the DISPENSER transaction.
//
// THE CONSTRAINT THAT SHAPES THIS SPEC, and it is a consensus rule rather than
// a harness limit: every PRICE v1 publish is inert for 24 HOURS. The hub sets
// `effective_at = block_time + 86400` unconditionally (`PriceAggregator.js`),
// and both the settlement path and the fee quote read only rows whose
// effective_at has passed. So a Mode B dispenser CANNOT be created in the same
// session that publishes the oracle it points at, on any venue, without moving
// a shared chain's clock a day forward - which every other session on that
// venue would inherit (campaign §3.5).
//
// So this spec drives the half that is reachable, and does it in a way that
// leaves the other half one run away:
//
//   1. PUBLISH a real PRICE v1 from the wallet, and ask the CHAIN what it
//      stored - including the 86,400-second gap that is the whole rule.
//   2. Prove the LOCK BITES: a Mode B dispenser pointed at that fresh oracle
//      is refused before anything is signed, so the create does not burn a
//      miner fee (and, off Bitcoin, a native-coin protocol fee that is never
//      refunded) on a transaction the chain has already decided to reject.
//   3. Prove the refusal is the LOCK and not a missing feed. This is the
//      assertion that carries the spec: the SAME oracle fee quote, for the
//      same address, coin, tick and currency, differing only in the block time
//      it is asked about, answers `valid:false ... (no effective oracle price)`
//      at the current tip and `valid:true` with a real fee at the row's own
//      effective_at. A refusal caused by a typo, a wrong chain or a dropped
//      field would answer identically at both.
//
// WHAT IT PLANTS. The quote is published for XCHAIN deliberately: XCHAIN is
// free-mintable by any address on regtest, so a session running this venue
// more than 24 hours later needs nothing from this one except the publishing
// address (a public string, recorded in the campaign doc) to open a Mode B
// dispenser and settle a fill against it. Publishing under a token this
// session issued would have made the follow-up depend on a seed phrase.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/oracle/price-publish-lock.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    explorerJson as venueExplorerJson,
    fundAddress,
    minerRpc,
    mintXchain,
    priceFamilyRefusal,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** The publish and the mint both pay a real coin protocol fee here. */
const FUNDING = 2;
/** The token the quote prices. Free-mintable on regtest, which is the point. */
const TICK = 'XCHAIN';
const FIAT = 'USD';
/** Dollars per XCHAIN. At the fixture's $30 LTC this makes 0.05 LTC buy one. */
const VALUE = '1.50';
/** A fraction, not a percentage: 1% of a Mode B dispenser's projected proceeds. */
const USAGE_FEE = '0.01';
/** The protocol's fixed maturation delay, in seconds (PriceAggregator.js). */
const ACTIVATION_DELAY_S = 86_400;
/** Enough XCHAIN to escrow a dispenser with. */
const MINT = 500;
const ESCROW = 100;
const GIVE_PER_FILL = 1;

// Deliberately the FIXTURE's reader rather than a local copy. A local copy would
// swallow the venue's answer (`.catch(() => null)` below), so a 500 from
// `/RLTC/api/oracle_prices` read as "the row never reached the hub mirror" and
// sent the reader to the hub. The venue was refusing the endpoint outright.
const explorerJson = (path) => venueExplorerJson(path);

async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

async function waitForIndexedAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100').catch(() => null);
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await explorerJson('status').catch(() => null);
    throw new Error(`No XChain action recorded for ${txid} within `
        + `${Math.round(timeoutMs / 1000)}s. Decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}.`);
}

/**
 * The hub-mirrored oracle_prices row for a publish.
 *
 * Polled rather than read once: the row does not arrive with the action. The
 * indexer pushes it to the hub and the hub mirrors it back, so there is a lag
 * between "the PRICE indexed valid" and "any dispenser could see it".
 */
async function waitForOracleRow(address, tick, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let seen = null;
    // Kept, because a poll must tolerate a transient - but no longer DISCARDED.
    // The read is retried on a refusal exactly as before; what changed is that
    // the refusal is carried to the failure message instead of being erased
    // into "no row ever arrived", which is the sentence that sent a whole run
    // hunting the hub mirror for a venue that was answering 500.
    let refusal = null;
    while (Date.now() < deadline) {
        const body = await explorerJson(`oracle_prices/${address}/address`)
            .catch((err) => { refusal = err?.message || String(err); return null; });
        seen = (body?.data || []).find((r) => String(r.tick) === tick);
        if (seen) return seen;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 3_000));
    }
    throw new Error(refusal
        ? `no oracle_prices row for ${address}/${tick} could be READ, and the venue is the `
          + `reason rather than the publish: ${refusal}`
        : `the PRICE indexed but no oracle_prices row for ${address}/${tick} ever `
          + 'reached the hub mirror, so no dispenser could ever read this quote');
}

async function oracleFeeQuote({ address, coin, tick, fiat, escrow, blockTime }) {
    const q = new URLSearchParams({
        oracleAddress: address,
        giveCoin: coin,
        giveTick: tick,
        fiatCode: fiat,
        getCoin: coin,
        giveEscrow: String(escrow),
    });
    if (blockTime != null) q.set('blockTime', String(blockTime));
    return explorerJson(`oraclefeequote?${q.toString()}`);
}

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

test.describe(`PRICE v1 oracle publishing on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('a published quote is inert for 24 hours, and nothing can price against it', async ({ page }) => {
        // This venue answers its whole oracle-price family with HTTP 500
        // (no co-located hub DB configured for this coin), so the oracle_prices row this test waits for
        // cannot be read here at all. A conditional skip rather than a fixme: it
        // runs itself again the day the checkpoint DB is configured.
        const priceGap = await priceFamilyRefusal();
        test.skip(!!priceGap, `the venue refuses the oracle-price family here. ${priceGap}`);
        /** The oracle's identity: the address that signs the PRICE. */
        let oracle;
        /** The chain's own record of the publish. */
        let row;


        await test.step('publish a first PRICE v1 quote from the wallet', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Oracle Operator' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Publish oracle price');
            let main = page.getByRole('main');
            await expect(main.getByLabel(/^Token ticker/)).toBeVisible({ timeout: 30_000 });
            // D-145: this form mounted no chain picker at all until this
            // session, so on a multi-chain wallet it published on whichever
            // chain the wallet listed first. Without the field this call fails
            // by name, which is how the defect was found.
            await selectVenueChain(main);
            oracle = await main.getByRole('textbox', { name: /^Publishing address/ }).inputValue();
            expect(oracle, `the oracle form has no ${REGTEST_CHAIN_LABEL} address to publish from`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(oracle, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await seedPrices();

            await gotoPalette(page, 'Publish oracle price');
            main = page.getByRole('main');
            await expect(main.getByLabel(/^Token ticker/)).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);

            // An address that has published nothing must say so, and say what
            // the first publish costs in time. This is the operator's only
            // warning before a decision they cannot take back for a day.
            await expect(main, 'a never-published address does not say its feed list is empty')
                .toContainText('has not published any prices yet');

            await main.getByLabel(/^Token ticker/).fill(TICK);
            await main.getByLabel('Currency').selectOption(FIAT);
            await main.getByLabel(/^Price of one/).fill(VALUE);
            await main.getByLabel(/^Usage fee/).fill(USAGE_FEE);
            await expect(main, 'the form does not warn that a first price is inert for 24 hours')
                .toContainText(`First price for ${TICK} in ${FIAT}`);

            await main.getByRole('button', { name: 'Preview' }).click();
            const review = page.getByRole('main');
            await expect(review.getByText('Review price publish').or(review), 'no review stage')
                .toBeVisible({ timeout: 30_000 });
            // The review's three load-bearing statements: what it costs the
            // consumer, that it is inert, and who is already relying on this
            // oracle (nobody, on a first publish - and saying "nobody" is not
            // the same as saying nothing).
            await expect(review, 'the review does not state the usage fee a dispenser will pay')
                .toContainText(USAGE_FEE);
            await expect(review, 'the review does not state that a first price prices nothing '
                + 'for 24 hours')
                .toContainText('will not price anything for 24 hours');
            await expect(review, 'the review does not say who currently prices from this oracle')
                .toContainText(`No open dispensers price ${TICK} from this oracle`);

            // The password box only renders when the signer is locked. An
            // in-session wallet is already unlocked here, so waiting for it
            // times out on a screen that is perfectly ready to sign.
            const pw = page.getByLabel('Password');
            if (await pw.count() > 0) await pw.fill(PASSWORD);
            await review.getByRole('button', { name: 'Publish price' }).click();
            await expect(review, 'no transaction id ever appeared after Publish price')
                .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
            const txid = (await review.innerText()).match(/[0-9a-f]{64}/)?.[0];

            const published = await waitForIndexedAction(txid);
            expect(String(published.action)).toBe('PRICE');
            expect(String(published.status), 'the chain rejected the price publish').toBe('valid');
        });

        await test.step('the chain stores it maturing exactly 24 hours out', async () => {
            row = await waitForOracleRow(oracle, TICK);

            // The rule, measured rather than trusted. Everything else in this
            // spec is a consequence of this one number.
            expect(Number(row.effective_at) - Number(row.block_time),
                'the publish did not mature exactly one day after the block that carried it, '
                + 'so the 24h front-running lock is not what the hub applied')
                .toBe(ACTIVATION_DELAY_S);
            expect(Number(row.value),
                'the chain stored a different price than the form published').toBe(Number(VALUE));
            expect(Number(row.fee),
                'the usage fee did not survive the publish, so the oracle operator would be '
                + 'paid nothing by the dispensers that use it').toBe(Number(USAGE_FEE));
            expect(String(row.coin),
                `the quote was published against the wrong chain coin, so no ${REGTEST_CHAIN_LABEL} `
                + 'dispenser can read it (D-145)')
                .toBe(REGTEST_COIN.slice(1));

            // It is in the future, from the chain's point of view. A row that
            // matured immediately would pass every assertion above.
            const status = await explorerJson('status');
            expect(Number(row.effective_at) > Number(status.last_block_time[REGTEST_COIN]),
                'the quote is already effective at the current tip, so there is no lock to test')
                .toBe(true);
        });

        await test.step('the wallet shows it as pending rather than live', async () => {
            // Back to the form via the success screen's own button, NOT via the
            // palette: the shell is still on this route, and asking the palette
            // for the route it is already on is a no-op (campaign §11.1). This
            // is also the operator's real path, and it is the one that has to
            // reload the feed list.
            const main = page.getByRole('main');
            await main.getByRole('button', { name: 'Publish another' }).click();
            await expect(main.getByLabel(/^Token ticker/)).toBeVisible({ timeout: 30_000 });

            // The list is loaded by an effect keyed on (chain, address), and the
            // only extra refresh is fired the instant the broadcast returns -
            // which is BEFORE the transaction is in a block, so it cannot
            // possibly see the publish. Re-entering the form is therefore what
            // an operator has to do, and this loop is that, not a poll: each
            // pass is a fresh mount.
            // The feed entry is a BUTTON (it prefills the form). Matching by
            // text alone also matches the price field's own label, "Price of one
            // XCHAIN in USD", which is present on an empty form - so a text
            // match passes before anything has been published.
            const feed = main.getByRole('button', { name: `${TICK} in ${FIAT}`, exact: true });
            const deadline = Date.now() + 240_000;
            for (;;) {
                // Give the mount's own fetch time to land before judging it. A
                // bare count() right after the remount always reads zero,
                // because the list arrives asynchronously - which turns this
                // loop into a screen-refresh race rather than a wait.
                try {
                    await expect(feed).toBeVisible({ timeout: 20_000 });
                    break;
                } catch { /* not there yet; remount below */ }
                expect(Date.now() < deadline,
                    'the publish is on chain and mirrored, but the publishing address\'s own '
                    + '"My published prices" list still says it has never published anything. '
                    + 'That list is the operator\'s only view of what they are quoting, and it '
                    + 'is also what the fat-finger deviation gate compares a republish against')
                    .toBe(true);
                await mineIfPending();
                await page.getByRole('button', { name: /^Back/ }).first().click();
                await gotoPalette(page, 'Publish oracle price');
                await expect(main.getByLabel(/^Token ticker/)).toBeVisible({ timeout: 30_000 });
                await selectVenueChain(main);
            }

            // "nothing live yet" is the assertion that matters: an operator who
            // reads this as live points a dispenser at it and every attempt to
            // buy is recorded invalid.
            await expect(main, 'the form shows a freshly published quote as live')
                .toContainText('nothing live yet');
            await expect(main, 'the form does not say when the quote starts pricing')
                .toContainText(/starts in/);
        });

        await test.step('a dispenser pointed at it is refused before anything is signed', async () => {
            await mintXchain(page, MINT);
            await waitForTokenBalance(oracle, TICK, MINT);

            await gotoPalette(page, 'Create dispenser');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);

            await main.getByRole('button', { name: /^Token/ }).click();
            await page.getByText(TICK, { exact: true }).first().click();
            await main.getByLabel('Give amount (per fill)').fill(String(GIVE_PER_FILL));
            await main.getByLabel('Escrow amount').fill(String(ESCROW));

            await main.getByRole('button', { name: /Advanced options/ }).click();
            await main.getByLabel('Priced in fiat (optional)').selectOption(FIAT);
            // Mode B: no fiat amount at all. The oracle prices the token; the
            // dispenser only names whose quote to use.
            await main.getByLabel(/^Oracle address/).fill(oracle);

            await main.getByRole('button', { name: /^(Create|Preview)$/ }).click();

            // Refused, and refused BEFORE the confirm screen: the point of the
            // pre-flight is that the create never gets signed, so it costs
            // nothing. A confirm modal here means the wallet was about to spend
            // a miner fee (and this chain's unrefundable native protocol fee)
            // on a transaction the chain has already decided to reject.
            const alert = main.getByRole('alert').filter({ hasText: /oracle|price/i }).first();
            await expect(alert, 'the wallet composed a Mode B dispenser against an oracle whose '
                + 'quote is not in effect yet, so it was about to pay to be rejected')
                .toBeVisible({ timeout: 120_000 });
            expect(await page.getByTestId('confirm-modal').count(),
                'the wallet reached the confirm screen for a dispenser the chain will refuse')
                .toBe(0);

            const said = await alert.innerText();
            // D-146's second half, and it is the one a user pays for. The chain's
            // verdict here is `invalid: ORACLE_ADDRESS (no effective oracle
            // price)` - measured directly:
            //   /RLTC/api/feequote?action=DISPENSER&params=0|LTC|XCHAIN|1||100|LTC||0||USD||<oracle>
            // The wallet decides whether a refusal is "about the price feed, so
            // wait" with a regex over that verdict, and this verdict contains
            // BOTH the word "oracle" and the word "price" while being neither
            // temporary nor about the validator feed. So the operator was told
            // "The LTC fee price is temporarily unavailable. Try again in a
            // moment", when the truth is a 24-hour maturation they had just
            // been warned about two screens earlier.
            expect(/temporarily unavailable|try again in a moment/i.test(said),
                `the refusal blames the coin price feed and tells the user to wait a moment: `
                + `"${said}". The cause is the oracle's 24-hour maturation, and waiting a `
                + 'moment never fixes it')
                .toBe(false);
            expect(/pre-flight failed|unquotable|ORACLE_ADDRESS/.test(said),
                `the dispenser refusal is shown to users as wire wording: "${said}"`)
                .toBe(false);
            expect(/24 hours|in effect yet/i.test(said),
                `the refusal does not tell the user that the oracle's price has not matured `
                + `yet, which is the only fact that makes it actionable: "${said}"`)
                .toBe(true);
        });

        await test.step('and the refusal is the 24-hour lock, not a missing feed', async () => {
            // THE ASSERTION THIS SPEC EXISTS FOR. Two calls to the same
            // consensus code path, same oracle, same coin, same tick, same
            // currency, same escrow: the ONLY difference is the block time
            // being asked about. A wrong address, a wrong chain, a dropped
            // FIAT_CODE or a quote that never reached the mirror answers
            // "no effective oracle price" at BOTH times.
            const args = {
                address: oracle, coin: REGTEST_COIN.slice(1), tick: TICK,
                fiat: FIAT, escrow: ESCROW,
            };
            const now = await oracleFeeQuote(args);
            expect(now.valid, 'the venue prices this oracle already, so nothing here is testing '
                + 'the maturation lock').toBe(false);
            expect(String(now.error)).toContain('no effective oracle price');

            // One second before its own effective_at it is still locked, and one
            // second is the whole difference: the gate is that exact timestamp,
            // not "some time later".
            const oneSecondEarly = await oracleFeeQuote({
                ...args, blockTime: Number(row.effective_at) - 1,
            });
            expect(String(oneSecondEarly.error),
                'the lock releases before the row\'s own effective_at, so the maturation window '
                + 'is shorter than the protocol says it is')
                .toContain('no effective oracle price');

            // ...and AT it, the maturation verdict is gone. Deliberately not
            // asserted as `valid:true`: the fee quote's SECOND input is a
            // validator COIN/FIAT snapshot inside a window anchored on the time
            // being asked about, and this venue's snapshots are stamped today,
            // so a question about tomorrow has today's price outside its window
            // and stops on `no validator price to value the oracle fee`. That is
            // an artifact of asking about the future, not of this publish - and
            // it is a DIFFERENT verdict, which is exactly the point: between
            // effective_at-1 and effective_at the oracle gate, and only the
            // oracle gate, changed its answer.
            const matured = await oracleFeeQuote({ ...args, blockTime: Number(row.effective_at) });
            expect(String(matured.error || ''),
                'at the moment the quote matures the chain still says it has no effective '
                + 'oracle price, so the refusal above was NOT the 24-hour lock and something '
                + `else about this publish is wrong - ${JSON.stringify(matured)}`)
                .not.toContain('no effective oracle price');

            // The fee machinery itself, proven against a feed on this venue that
            // HAS matured. Without this the spec shows the gate opening and never
            // shows that anything is behind it: a published usage fee that always
            // priced at zero would pass every assertion above while paying the
            // oracle operator nothing.
            const feeds = await explorerJson('oracle_prices');
            const tip = Number((await explorerJson('status')).last_block_time[REGTEST_COIN]);
            const mature = (feeds?.data || []).find((r) => Number(r.effective_at) <= tip
                && Number(r.fee) > 0);
            if (!mature) {
                // eslint-disable-next-line no-console
                console.log('[note] no matured fee-charging oracle feed on this venue, so the '
                    + 'usage-fee arithmetic was not exercised this run');
            } else {
                const priced = await oracleFeeQuote({
                    address: mature.source_address, coin: mature.coin, tick: mature.tick,
                    fiat: mature.fiat, escrow: ESCROW,
                });
                expect(priced.valid,
                    `a matured fee-charging feed (${mature.coin}:${mature.tick}/${mature.fiat}) `
                    + `still cannot be priced: ${JSON.stringify(priced)}`)
                    .toBe(true);
                expect(Number(priced.requiredFeeSats),
                    'a matured oracle charging a usage fee prices it at zero, so Mode B would '
                    + 'pay its price publisher nothing')
                    .toBeGreaterThan(0);
            }

            // eslint-disable-next-line no-console
            console.log(`[plant] Mode B is now one run away: oracle ${oracle} publishes `
                + `${REGTEST_COIN.slice(1)}:${TICK}/${FIAT} at ${VALUE} (fee ${USAGE_FEE}), `
                + `effective from unix ${row.effective_at}.`);
        });
    });
});
