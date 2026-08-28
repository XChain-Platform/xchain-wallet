// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Coverage: SWEEP": the first spec on a lane that had
// no directory at all. SWEEP is the wallet's single most destructive action -
// it moves EVERY token balance and ownership an address holds to one
// destination in one signature, and by flag force-closes that address's open
// orders, swaps and dispensers so their escrow follows - and until this file
// nothing drove it against a chain.
//
// WHY THIS SLICE, and not the other four residuals on the row. Everything here
// is constructible on the Litecoin venue in one wallet, and each leg answers a
// question the others cannot:
//
//   THE WIZARD, END TO END. SweepForm is not a form with a submit button: it is
//   a preview (a host `sweep.preview` fan-out across five explorer endpoints), a
//   per-category selection, a typed-word gate on the confirm screen, and a
//   terminal screen. A rendering test can reach none of that, because the
//   preview counts come from the chain and the typed gate sits on the composed
//   PSBT's confirm surface.
//
//   THE "Sweep broadcast" SCREEN. The campaign row records ONE unreproduced
//   observation: a sweep that succeeded and never showed this screen. That is
//   the worst failure this action has - the user is left believing nothing
//   happened after signing away everything the address held - so the heading is
//   asserted as its own claim, with the txid read off it, and a chain read
//   afterwards that would catch the inverse (a screen with no sweep behind it).
//
//   THE FORCE-CLOSE AT THE SOURCE. A dispenser is the cheapest state-bearing
//   object to construct (see tests/dispensers/ for the same create flow), and
//   its close is the one whose consequence is DEFERRED, which makes it the one
//   most worth pinning: the wallet says "dispensers close after the standard
//   1-hour window", and the chain must actually have marked the dispenser
//   `cancelling` with the sweep's SOURCE as canceller. Whether the escrow then
//   reaches the destination is a separate, unreachable claim - see the fixme at
//   the bottom, which pins no defect.
//
// WHAT WOULD BE FALSE IF THIS PASSED VACUOUSLY. Every screen figure here has an
// independent reader:
//   - "Sweep broadcast" plus a txid is the WALLET reporting on itself. The
//     action detail is read back from the explorer and must be a valid SWEEP
//     whose source, destination and five category flags are exactly what the
//     form was driven with - so a sweep that silently dropped the dispenser
//     checkbox, or sent to a different address, fails here and not on screen.
//   - The money is read from `/api/balances/`, never from the wallet: the
//     source must be drained to ZERO and the destination credited. A sweep that
//     broadcast a well-formed action the handler rejected would show the same
//     success screen and fail on these two reads.
//   - The dispenser's own action detail must say `cancelling`, cancelled by the
//     swept address.
//
// THE DESTINATION IS DELIBERATELY NOT OURS. It is a throwaway address nothing
// holds the key to, which is both the honest shape for an e2e destination and
// the loud path through the form: SweepForm warns "Not your address" only when
// the destination is valid and NOT one of the wallet's own, and that warning is
// the last thing standing between a user and handing an address's entire
// contents to a stranger. It is asserted on the way past.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/sweep/force-close-and-broadcast.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal as sharedConfirmModal,
    EXPLORER_URL,
    fundAddress,
    mintXchain,
    nudgeChain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    REGTEST_DESTINATION,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Three fee-bearing broadcasts ride on this address: mint, dispenser, sweep. */
const FUNDING = 2;
const TICK = 'XCHAIN';
const MINT = 1000;
/** Escrowed into the dispenser, so the sweep has an offer to force-close. */
const ESCROW = 100;
const GIVE_PER_FILL = 25;
/** What a buyer would pay for one fill. Never exercised here. */
const TRIGGER = '0.001';

/**
 * Throwaway destinations, per chain, that nothing holds the key to.
 *
 * The fixture pins the Bitcoin one; the Litecoin one is the address the Send
 * lane's `dust-and-max` spec derived and wrote down for exactly this need (a
 * p2wpkh over `hash160('xchain-wallet-e2e-rltc-destination')` on
 * litecoin-regtest params), and its bech32 decode was re-checked against the
 * wallet's OWN validator table (`shared/utils/addressValidation.js`: litecoin
 * regtest hrp `rltc`) before being used here. A cross-HRP address is refused by
 * the form's destination field long before any of this spec's subject matter is
 * reached, so a chain with no entry fails loudly in the first step rather than
 * on a mystery form error.
 */
const DESTINATIONS = {
    RBTC: REGTEST_DESTINATION,
    RLTC: 'rltc1q94wew2dxt8psxdx670k2yc9620ljmd4w847rcl',
};
const DESTINATION = DESTINATIONS[REGTEST_COIN];

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * Opens a screen through the command palette.
 *
 * Lifted from tests/dispensers/refill-ceiling: the palette is the one entry
 * point every shell has, and SweepForm has no nav row of its own - the only
 * other ways in are the actions menu and MigrateToBip39's per-chain deep link.
 */
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

/** Waits for the confirm surface itself, WITHOUT requiring Approve to be live. */
/**
 * The shared reader, plus this lane's own checks.
 *
 * A narrower wait races the modal against the stale-price alert and nothing
 * else, so every OTHER refusal the screen carried read as the modal simply
 * not being there - which is how the shared explorer's 429 was reported as a
 * locator timeout for four runs. `expectConfirmModal` reads every alert on
 * the screen instead. The price check stays because it names one venue state
 * early and by itself.
 */
async function expectConfirmModal(page) {
    const modal = await sharedConfirmModal(page, 'this action', 60_000);
    expect(await page.getByText(/fee price is temporarily unavailable/).count(),
        'the venue could not price this action: the price sentinel has gone stale mid-run. '
        + 'Venue state, not a wallet defect - re-seed (campaign §3.2) and re-run')
        .toBe(0);
    return modal;
}

async function approveAndGetTxid(page) {
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

/**
 * Polls an address's balance of `tick` until `predicate` accepts it.
 *
 * `waitForTokenBalance` answers "did it reach at least N", which cannot express
 * the assertion that matters after a sweep: the source must reach ZERO. Mines
 * through `nudgeChain`, never a bare `generate_blocks`, so a decoder that is
 * already behind is not pushed further behind while this waits.
 */
async function waitForBalance(address, tick, predicate, what, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (last != null && predicate(last)) return last;
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${what} (${address} holds ${last} ${tick} after `
        + `${Math.round(timeoutMs / 1000)}s)`);
}

/**
 * The dispenser's live status as the CHAIN reports it.
 *
 * Screen fact, from the explorer's action-detail layer: a DISPENSER's current
 * status is `state.status` (the newest `dispenser_statuses` row), NOT the
 * top-level `status`, which is the CREATE's own verdict and stays `valid`
 * forever. A spec reading the top-level field would never see a close.
 */
async function waitForDispenserStatus(index, expected, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let row = null;
    while (Date.now() < deadline) {
        row = await explorerJson(`action/${index}`).catch(() => row);
        if (String(row?.state?.status || '') === expected) return row;
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`dispenser #${index} never reached status "${expected}" `
        + `(last="${row?.state?.status}")`);
}

test.describe(`sweep force-close and broadcast on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    // FIXME'd 2026-08-27 ON A PRODUCT DEFECT, NOT ON ANYTHING ABOUT SWEEPING,
    // and it is a tracked defect rather than an anonymous red.
    //
    // Driven centrally on Litecoin, this reached further than any SWEEP spec
    // has: the form composed with a real source and destination on the venue
    // chain, the preview counted the token balance and named the dispenser and
    // its escrow, and the third-party-destination warning fired. Then the
    // wallet refused to submit, correctly:
    //
    //   "This action's protocol fee (0.00000600 LTC) is too small to send as a
    //    LTC payment, and LTC is the only way to pay a protocol fee on this
    //    chain, so it cannot be submitted here."
    //
    // THE FIRST READING OF THIS WAS WRONG, AND CORRECTING IT HERE MATTERS,
    // because it sent the next session to retune a fixture constant. It blamed
    // the venue's LTC/USD 30.00 seed and concluded "every cheaper action prices
    // under dust". Measured at the source, both halves are false.
    //
    // SWEEP and CALLBACK are the only two actions still on the LEGACY per-DB-hit
    // fee (`getTransactionFee`, a flat 1000 sats of XCHAIN per hit, with no
    // UNIFIED_FEES branch); DIVIDEND and AIRDROP take the gas schedule and price
    // far above dust, as does every gas-scheduled action the suite drives. The
    // quoted 600 sats back-solves to exactly 9 DB hits. A chain's payable
    // minimum is its dust floor times the coin price, so on Litecoin a SWEEP
    // needs roughly 273 DB hits at a realistic $100 LTC before it can be
    // submitted AT ALL, and Litecoin has no XCHAIN lane to fall back to.
    //
    // So this reproduces on MAINNET Litecoin, and no venue price fixes it: the
    // band that lifts a 9-hit sweep over dust also costs ISSUE its headroom
    // against `fundAddress`'s one-coin default. Un-fixme when the sweep lands a
    // fee that stays above the target chain's dust floor; nothing here needs
    // rewriting first.
    test.fixme('a sweep drains the address, credits the destination, and force-closes its dispenser', async ({ page }) => {
        expect(DESTINATION,
            `no throwaway destination is pinned for ${REGTEST_COIN}; add one derived on this `
            + 'chain\'s regtest params rather than reusing another chain\'s (the form refuses it)')
            .toBeTruthy();
        expect(DESTINATION, 'the pinned destination is not an address this chain can pay')
            .toMatch(REGTEST_ADDRESS_RE);

        let source;
        let dispenserIndex;

        await test.step('fund an address, give it a token balance and an open dispenser', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Sweep Owner' });
            await switchToRegtest(page, PASSWORD);

            // The dispenser form READS the wallet's own venue-chain
            // address, the same way the dispenser specs do: addresses derive
            // from a random seed, so the spec cannot know it in advance.
            await gotoPalette(page, 'Create dispenser');
            let main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            source = await main.getByRole('textbox', { name: 'Source' }).inputValue();
            expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);
            expect(source, 'the throwaway destination collides with the wallet\'s own address')
                .not.toBe(DESTINATION);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT);
            await waitForTokenBalance(source, TICK, MINT);
            await seedPrices();

            await gotoPalette(page, 'Create dispenser');
            main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByRole('button', { name: /^Token/ }).click();
            await page.getByText(TICK, { exact: true }).first().click();
            await main.getByLabel('Give amount (per fill)').fill(String(GIVE_PER_FILL));
            await main.getByLabel('Escrow amount').fill(String(ESCROW));
            await main.getByLabel(/Trigger price/).fill(TRIGGER);

            await main.getByRole('button', { name: /^(Create|Preview)$/ }).click();
            await expectConfirmModal(page);
            const created = await waitForValidAction(await approveAndGetTxid(page));
            dispenserIndex = String(created.action_index);
            // Polled, not read once: the create's own `dispenser_statuses` row
            // ('open', indexer actions/dispenser.js) is what the sweep's
            // force-close later supersedes, and the whole force-close leg of
            // this spec is meaningless if the dispenser was never open.
            await waitForDispenserStatus(dispenserIndex, 'open');
        });

        let before;
        let destBefore;

        await test.step('drive the sweep wizard, with the dispenser force-close selected', async () => {
            await gotoPalette(page, 'Sweep address');
            const main = page.getByRole('main');
            // Screen facts (SweepForm.jsx + ui/PageHeader.jsx + ui/Screen.jsx):
            //   - The page title ("Sweep address" free-entry, "Sweep to new
            //     wallet" in the MigrateToBip39 lane) is a PageHeader <span>
            //     inside <header>, NOT a heading and NOT inside <main>. Landing
            //     is therefore asserted on the form's own top warning, which is
            //     unique to this screen. Asking for a heading here costs the
            //     whole action timeout and reports nothing useful.
            //   - The chain picker is a NetworkField, visible label "Network".
            //   - The source is a READ-ONLY AddressField labelled "From" whose
            //     trailing icon ("Choose source address") opens the own-address
            //     picker; that picker's rows are labelled "View address <addr>".
            await expect(main.getByText(/Sweep moves everything selected at once/).first(),
                'the palette did not land on the sweep form').toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);

            const fromField = main.getByRole('textbox', { name: 'From', exact: true });
            await expect(fromField, 'the sweep form defaulted to an address that is not the one '
                + 'this run funded, so it would sweep the wrong address')
                .toHaveValue(source, { timeout: 30_000 });

            await main.getByLabel('Destination address').fill(DESTINATION);

            // The loud third-party path. This alert is the only thing between a
            // user and handing an address's entire contents to a stranger, and
            // it is shown ONLY when the destination parses for this chain and is
            // not one of the wallet's own.
            await expect(main.getByText(/This wallet does not own the destination/).first(),
                'a valid destination the wallet does not own raised no warning')
                .toBeVisible({ timeout: 15_000 });

            // The preview is an API fan-out over five explorer endpoints
            // (flows/sweepPreview.js), rendered as a count appended to each
            // category label: "Open dispensers (force-close) (1)". A count of
            // "…" means it never resolved and "preview unavailable" means the
            // category's endpoint failed, so asserting the NUMBER proves the
            // host route reached this venue and saw the objects just created.
            await expect(main.getByRole('checkbox', { name: /^Token balances \(1\)/ }),
                'the sweep preview does not see the token balance this address holds')
                .toBeVisible({ timeout: 60_000 });
            const dispensers = main.getByRole('checkbox', {
                name: /^Open dispensers \(force-close\) \(1\)/,
            });
            await expect(dispensers,
                'the sweep preview does not see the open dispenser at the source')
                .toBeVisible({ timeout: 60_000 });

            // Balances and ownerships default ON; the three force-close
            // categories default OFF, because each cancels something. Only
            // dispensers is armed here, and the chain is asked afterwards
            // whether exactly that reached the wire.
            await expect(dispensers, 'a force-close category defaulted to ON').not.toBeChecked();
            await dispensers.check();

            before = await tokenBalance(source, TICK);
            expect(before, 'the source holds no token balance to sweep').toBeGreaterThan(0);
            // The destination is a PINNED address on a SHARED venue, so every
            // previous run of this spec left its credit there. Measure the
            // DELTA, never the total: `> 0` would pass on the second run without
            // this sweep having moved anything at all.
            destBefore = await tokenBalance(DESTINATION, TICK);

            await main.getByRole('button', { name: 'Sweep', exact: true }).click();
        });

        let txid;

        await test.step('the typed gate holds, and the sweep reaches its broadcast screen', async () => {
            const modal = await expectConfirmModal(page);

            // Screen fact: SWEEP rides the typed-word rail DESTROY uses, and the
            // confirm screen's copy carries the word in quotes ('Type "SWEEP" to
            // confirm') while the legacy review stage's does not. Approve stays
            // disabled until it is typed - which is asserted BEFORE typing, or
            // the gate would be untested.
            const approve = page.getByTestId('confirm-approve');
            await expect(approve, 'Approve is live before the confirmation word was typed, so the '
                + 'typed gate on the most destructive action in the wallet does nothing')
                .toBeDisabled();

            const typed = modal.getByRole('textbox', { name: /^Type .?SWEEP.? to confirm$/ });
            await expect(typed, 'the confirm screen carries no typed-confirmation field')
                .toBeVisible({ timeout: 30_000 });
            await typed.fill('SWEEP');

            txid = await approveAndGetTxid(page);

            // The campaign's one unreproduced observation, asserted as its own
            // claim: a sweep that broadcast and showed no terminal screen leaves
            // the user believing nothing happened after signing away everything
            // the address held.
            const main = page.getByRole('main');
            await expect(main.getByRole('heading', { name: 'Sweep broadcast' }),
                'the sweep broadcast but never showed its "Sweep broadcast" screen (campaign '
                + 'row 31\'s unreproduced observation, reproduced)')
                .toBeVisible({ timeout: 60_000 });
            await expect(main, 'the broadcast screen does not tell a user that the dispensers they '
                + 'force-closed settle later, so a missing escrow reads as a lost one')
                .toContainText(/close after the standard 1-hour window/);
        });

        await test.step('the chain recorded the sweep the form was driven with', async () => {
            const detail = await waitForValidAction(txid);
            expect(String(detail.action), 'the broadcast was not a SWEEP').toBe('SWEEP');
            expect(String(detail.source), 'the chain swept an address this run never funded')
                .toBe(source);
            expect(String(detail.destination),
                'the chain routed the sweep somewhere other than the typed destination')
                .toBe(DESTINATION);
            // The five category flags, exactly as the checkboxes were left. A
            // form that dropped the dispenser box, or armed ORDERS/SWAPS nobody
            // asked for, is invisible on screen and fails here.
            expect(Number(detail.balances), 'BALANCES did not reach the wire').toBe(1);
            expect(Number(detail.ownerships), 'OWNERSHIPS did not reach the wire').toBe(1);
            expect(Number(detail.dispensers),
                'the dispenser force-close was checked on screen and did NOT reach the wire')
                .toBe(1);
            expect(Number(detail.orders), 'ORDERS was armed without being asked for').toBe(0);
            expect(Number(detail.swaps), 'SWAPS was armed without being asked for').toBe(0);
        });

        await test.step('the money moved: source emptied, destination credited', async () => {
            await waitForBalance(source, TICK, (v) => v === 0,
                'the swept address still holds tokens, so the sweep did not sweep');

            const after = await waitForBalance(DESTINATION, TICK, (v) => v > destBefore,
                'the sweep destination was never credited');
            const credited = after - destBefore;

            // The protocol fee is debited from the swept balance before it is
            // credited (indexer actions/sweep.js), and its size is a function of
            // the db-hits fee schedule and the LEGACY_FEE_NUMERIC_DBHITS
            // flag-day - so it is BOUNDED here rather than pinned to a figure
            // this spec would have to re-derive on every schedule change. What
            // is pinned is the part that matters: essentially all of it arrived,
            // and none of it went anywhere else.
            expect(credited, 'the destination was credited MORE than the source held')
                .toBeLessThanOrEqual(before);
            expect(before - credited,
                `only ${credited} of ${before} ${TICK} reached the destination; the shortfall is `
                + 'far larger than any protocol fee, so the sweep lost tokens on the way')
                .toBeLessThan(0.01);
        });

        await test.step('the force-close reached the dispenser at the source', async () => {
            const row = await waitForDispenserStatus(dispenserIndex, 'cancelling');
            // `cancelling`, not `cancelled`: a dispenser closes after
            // DISPENSER_CLOSE_DELAY, and the sweep only marks it. The canceller
            // recorded on that mark is what routes the escrow at close time
            // (indexer actions/dispenser_close.js prefers the sweep destination,
            // then this canceller), so it is asserted rather than assumed.
            expect(String(row.cancelled_by),
                'the dispenser is closing, but not on account of the swept address')
                .toBe(source);
        });
    });

    // NOT A DEFECT, AND NOT DONE. The other half of the force-close: when the
    // close window elapses, DISPENSER_CLOSE must credit the dispenser's
    // remaining escrow to the SWEEP's destination rather than back to its owner
    // (indexer actions/dispenser_close.js: `getSweepDestination` wins over the
    // recorded canceller). Nothing above proves that, and the test above says so
    // where it stops.
    //
    // It is parked because the window is DISPENSER_CLOSE_DELAY = 3600 SECONDS OF
    // BLOCK TIME (indexer config.js), and regtest block timestamps track the
    // wall clock: mining does not shorten it. Reaching it needs the node's clock
    // moved, which on this shared venue is the `setmocktime` hazard that wedges
    // the miner for every other session - so it wants a venue of its own, or a
    // harness that owns the clock, not a longer timeout.
    test.fixme('the swept dispenser\'s escrow reaches the sweep destination at close time', async () => {});
});
