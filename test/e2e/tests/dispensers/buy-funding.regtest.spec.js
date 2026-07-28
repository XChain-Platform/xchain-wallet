// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-37 (, verification leg ): the dispenser buy-funding gate,
// walked live.
//
// The fix itself shipped as xchain-wallet b62e157 + a966ea2 and has unit
// coverage. What had never run is the LIVE walk: a real buyer, on a real
// chain, looking at a real dispenser they cannot pay for. That is the leg
// this spec closes.
//
// THE FIXTURE IS THE HARD PART, and three facts about the shipped component
// determine it. All three were read out of DispenserDetail.jsx rather than
// assumed, because getting any of them wrong yields a spec that passes while
// testing nothing.
//
// 1. THE GATE ONLY EXISTS FOR A TOKEN-PRICED DISPENSER. `canBuyWithSend`
//    requires `isTokenPaid`, i.e. a non-empty GET_TICK. A coin-paid
//    dispenser (the common shape on this chain - #445 is one) renders the
//    "Pay to buy" instruction panel instead, which has no funding check at
//    all. So the fixture must create a dispenser priced in a TOKEN, and this
//    spec asserts that on the explorer row before it believes anything the
//    UI says.
//
// 2. THE BUYER MUST BE A DIFFERENT WALLET, not merely a different address.
//    `canBuyWithSend` also requires `!ownerAddress`, and `ownerAddress` is
//    resolved by matching the dispenser's SOURCE against
//    `getAddressesByChain(walletId)` - every address in the wallet, not just
//    the active one. A one-wallet fixture (address A opens, address B buys)
//    therefore renders the OWNER panel and no buy panel at all, so the
//    assertions below would have nothing to bind to. Hence two browser
//    contexts with two independent wallets: the seller's context builds the
//    fixture, the spec's own `page` is the buyer.
//
// 3. THE BUYER MUST BE ABLE TO FUND ITSELF, or the sensitivity flip needs a
//    cross-wallet transfer. XCHAIN is free-mintable on regtest by any
//    address, so pricing the dispenser IN XCHAIN lets the buyer go from zero
//    to funded through the mint path the fixtures already have. The give
//    tick is a throwaway token the seller issues, unique per run. (The
//    ledger's sketch had these the other way round - pay in an issued token,
//    give XCHAIN - which is equivalent in what it proves and strictly more
//    machinery, because funding the buyer then needs the seller to send.)
//
// SENSITIVITY IS THE POINT. A panel that always refuses passes every
// assertion about a refusal, and a funding gate is exactly the kind of
// control that invites that failure mode. So the fail verdict is proven
// twice over: once as itself, and once by minting the buyer the missing
// balance and requiring the SAME screen to flip to `pass` with the button
// enabled. Without the flip this spec could not tell a working gate from a
// broken one.
//
// The pre-flight here is deliberately `restricted` (funding-only), so
// nothing below asserts that the fill would land - only that the buyer
// cannot pay, and then that they can. Whether the dispenser is still open
// when the payment confirms is not a question a local balance check can
// answer, and the panel says so.
//
// NOTE ON FIXTURES: this spec creates every on-chain object it needs. The
// dispensers the original campaign observed (#3543 and friends) do not exist
// any more - the BTC regtest chain was rebuilt during the  recovery
//  - and a spec that reused an index would fail as `exists:false`.

import {
    LICENSE_ACCEPTED_AT_KEY,
    LICENSE_ACCEPTED_VERSION_KEY,
    createWallet,
    expect,
    test,
} from '../../fixtures/wallet.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import {
    EXPLORER_URL,
    REGTEST_COIN,
    fundAddress,
    mintXchain,
    nudgeChain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;

/** Seller's XCHAIN float: covers the ISSUE and DISPENSER protocol fees. */
const SELLER_XCHAIN = 5000;

/** Give-token economics. Non-divisible (the issue form's default), so whole. */
const GIVE_SUPPLY = '1000';
const GIVE_PER_FILL = '10';
const GIVE_ESCROW = '100';

/**
 * Price per fill, in XCHAIN, and the buyer's eventual balance.
 *
 * XCHAIN carries 0 decimals on this stack, so these stay integers and the
 * pre-flight's authored message is exactly predictable. BUYER_MINT is over a
 * thousand on purpose: the footer formats with thousands separators, so
 * "1,000 XCHAIN available" also proves the flip re-rendered from the real
 * balance rather than from a cached string.
 */
const PRICE_PER_FILL = '5';
const BUYER_MINT = 1000;

/**
 * A unique give-token ticker per run.
 *
 * Must not collide on a shared chain (a second ISSUE of a live ticker is
 * rejected), and must not start with 'A', which is reserved for numeric
 * asset references. Letters only, derived from the clock.
 */
function uniqueGiveTick() {
    let n = Date.now() % (26 ** 6);
    let tail = '';
    for (let i = 0; i < 6; i += 1) {
        tail = String.fromCharCode(65 + (n % 26)) + tail;
        n = Math.floor(n / 26);
    }
    return `DISP${tail}`;
}

const GIVE_TICK = uniqueGiveTick();

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * A second, fully independent wallet in its own browser context.
 *
 * The license gate has to be seeded here by hand: the `page` fixture in
 * wallet.js does it via an init script, and that only covers the page the
 * fixture hands out. A context made directly would otherwise open onto the
 * legal gate and the onboarding walk would fail on a missing button.
 */
async function openSecondWallet(browser) {
    const context = await browser.newContext();
    await context.addInitScript(
        ([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch {
                // Storage unavailable: the gate renders and onboarding fails
                // loudly rather than silently testing the gate.
            }
        },
        [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
    );
    return { context, page: await context.newPage() };
}

/** Reaches a destination through the command palette (see bet-roundtrip). */
async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const combobox = page.getByRole('combobox').first();
    await expect(combobox).toBeVisible();
    await combobox.fill(title);
    await page.keyboard.press('Enter');
}

/** The wallet's shared confirm surface. */
async function approveConfirm(page) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('confirm-approve').click();
}

/** Fills a password field only when the form is asking for one. */
async function fillPasswordIfPresent(scope) {
    const field = scope.getByLabel('Password', { exact: true });
    if (await field.count() > 0 && await field.isVisible()) await field.fill(PASSWORD);
}

/** Back to a clean unlocked Home, which is also how forms pick up new balances. */
async function remount(page) {
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
}

/**
 * Polls the explorer until `address` holds at least `min` of `tick`.
 *
 * Deliberately not the shared fixture's `waitForTokenBalance`: that one mines
 * on EVERY pass, which outruns the decoder on a busy shared venue - the state
 * being waited for then never indexes and the loop responds by mining harder.
 * `nudgeChain` only mines while the pipeline is keeping up, which is all a
 * balance wait ever needs (blocks advance state; they do not make an
 * already-mined action visible).
 */
async function waitForToken(address, tick, min, timeoutMs = 420_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            const body = await explorerJson(`balances/${address}`);
            const row = (body?.data || []).find((b) => b.tick === tick);
            last = row ? row.amount : null;
            if (row && Number(row.amount) >= min) return row;
        } catch { /* transient while a block lands */ }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance never reached ${min} for ${address} (last=${last})`);
}

/**
 * Polls the explorer until `source` has a dispenser giving `giveTick`.
 *
 * Reads the CHAIN rather than the seller's own screen: "created" on the
 * wallet's terminal page is the wallet reporting on itself, and the buyer in
 * the other context can only ever see what the indexer wrote.
 */
async function waitForDispenser(source, giveTick, timeoutMs = 420_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            const body = await explorerJson(`dispensers/${source}/source`);
            last = body?.data || [];
            const row = last.find((d) => String(d.give_tick) === giveTick);
            if (row) return row;
        } catch { /* transient while a block lands */ }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(
        `no dispenser giving ${giveTick} landed for ${source}; last=${JSON.stringify(last)}`,
    );
}

/** Navigates the BUYER from an unlocked Home to the fixture's dispenser. */
async function openDispenserAsBuyer(page, sellerAddress) {
    // Two hops, because the palette does NOT carry the dispenser explorer.
    // Its registry has `Dispensers` (the owner list) and `Create dispenser`,
    // and nothing for `dispenser-explorer`; typing "Browse dispensers" into it
    // returns "No matches". The buyer-facing browse surface lives only in the
    // Token Actions catalogue, which the palette reaches as "All actions" -
    // and that is the walk a real buyer makes too.
    await gotoPalette(page, 'All actions');
    await page.getByRole('button', { name: /^Browse dispensers/ }).click();

    // Anchored on a CONTROL, not on the page title: PageHeader renders its
    // title as a plain <span>, so there is no heading role to wait for here.
    const byAddress = page.getByRole('radio', { name: 'By address' });
    await expect(byAddress).toBeVisible({ timeout: 30_000 });

    // Pin the chain filter. Left at its "All chains" default this form fans
    // the query out over EVERY registered chain in parallel, mainnet Bitcoin,
    // Litecoin and Dogecoin included - which is both slower and a live
    // mainnet call from a regtest test. Narrowing it keeps the run entirely
    // on the regtest venue.
    await page.getByLabel('Chain').selectOption('bitcoin-regtest');

    // Search by the SELLER's address rather than by ticker: the ticker lane
    // matches GIVE_TICK and GET_TICK both, so a search for XCHAIN would drag
    // in every unrelated dispenser on this shared chain.
    await byAddress.check();
    await page.getByLabel('Address', { exact: true }).fill(sellerAddress);
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    // The row's label leads with the give tick, which is unique to this run.
    const row = page.getByRole('button', { name: new RegExp(`^${GIVE_TICK}\\b`) });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.click();

    await expect(page.getByText('Buy from this dispenser')).toBeVisible({ timeout: 60_000 });
}

test.describe('dispenser buy funding gate on regtest', () => {
    // A wrong selector otherwise hangs until the whole test times out and
    // reports nothing useful; 30s makes it fail naming itself.
    test.use({ actionTimeout: 30_000 });

    // Two onboardings, two funded addresses, an ISSUE, a DISPENSER and a MINT,
    // each waiting on real blocks - and this venue is shared, so the decode and
    // index pipeline can run minutes behind the node while another suite drives
    // it.
    test.setTimeout(2_400_000);

    /** @type {import('@playwright/test').BrowserContext | null} */
    let sellerContext = null;

    test.afterAll(async () => {
        // Never fail a run in teardown; a leaked context only costs the worker.
        try { await sellerContext?.close(); } catch { /* best effort */ }
    });

    test('a buyer holding none of the payment token is blocked, and funding unblocks them', async ({ browser, page }) => {
        let sellerAddress;
        let buyerAddress;
        let dispenserRow;

        await test.step('seller: onboard onto regtest and fund the signing address', async () => {
            const opened = await openSecondWallet(browser);
            sellerContext = opened.context;
            const seller = opened.page;

            await createWallet(seller, { password: PASSWORD });
            await switchToRegtest(seller, PASSWORD);

            // Read the address OFF THE FORM that will sign, not off Receive.
            // They are not always the same (Receive can hand back a rotated
            // one), and funding the wrong one produces a fixture signed by an
            // address this spec never funded - which only works by accident on
            // a chain that happens to carry stale coins.
            await gotoPalette(seller, 'Issue token');
            sellerAddress = await seller.getByRole('main')
                .getByLabel('From', { exact: true }).inputValue();
            expect(sellerAddress, 'the issue form names a source address')
                .toMatch(/^(bcrt1|[mn2])/);

            await fundAddress(sellerAddress, FUNDING_BTC);
            await remount(seller);
        });

        await test.step('seller: mint XCHAIN to cover the protocol fees', async () => {
            const seller = sellerContext.pages()[0];
            await mintXchain(seller, SELLER_XCHAIN);
            await waitForToken(sellerAddress, 'XCHAIN', SELLER_XCHAIN);
            await remount(seller);
        });

        await test.step('seller: issue the throwaway give token', async () => {
            const seller = sellerContext.pages()[0];
            await gotoPalette(seller, 'Issue token');

            const main = seller.getByRole('main');
            // The address that signs must still be the one that was funded.
            expect(await main.getByLabel('From', { exact: true }).inputValue(),
                'the issue form still signs with the funded address').toBe(sellerAddress);

            await main.getByLabel('Ticker', { exact: true }).fill(GIVE_TICK);
            await main.getByLabel('Supply', { exact: true }).fill(GIVE_SUPPLY);
            // "Initial mint" left blank mints the whole supply now, and
            // "Divisible" is unchecked by default, so the token carries 0
            // decimals and every amount below stays a whole number.
            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();
            await approveConfirm(seller);

            // The chain's answer, not the app's.
            await waitForToken(sellerAddress, GIVE_TICK, Number(GIVE_SUPPLY));
            await remount(seller);
        });

        await test.step('seller: open a dispenser priced in XCHAIN', async () => {
            const seller = sellerContext.pages()[0];
            await gotoPalette(seller, 'Create dispenser');

            const main = seller.getByRole('main');
            expect(await main.getByLabel('Source', { exact: true }).inputValue(),
                'the dispenser form still signs with the funded address').toBe(sellerAddress);

            // The give tick comes from a picker, so it can only ever be one
            // this address actually holds.
            await main.getByRole('button', { name: /^Token:/ }).click();
            await seller.getByLabel('Search coins or tokens').fill(GIVE_TICK);
            await seller.locator(`[data-balance-key$=":${GIVE_TICK}"]`).first().click();

            // AmountField folds the tick into its label once one is selected,
            // hence the prefix match rather than an exact name.
            await main.getByLabel(/^Give amount \(per fill\)/).fill(GIVE_PER_FILL);
            await main.getByLabel(/^Escrow amount/).fill(GIVE_ESCROW);

            // THE FIXTURE'S WHOLE POINT: token-priced, not coin-priced. A
            // native-coin dispenser renders the pay-here panel, which has no
            // funding check, and every assertion below would be vacuous.
            await main.getByRole('radio', { name: 'A token' }).check();
            await main.getByLabel('Payment token', { exact: true }).fill('XCHAIN');
            await main.getByLabel('Payment amount (per fill)', { exact: true })
                .fill(PRICE_PER_FILL);

            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Create', exact: true }).click();
            await approveConfirm(seller);

            dispenserRow = await waitForDispenser(sellerAddress, GIVE_TICK);

            // Assert the fixture is the shape the gate needs BEFORE trusting
            // anything the buyer's screen says about it. If GET_TICK came back
            // null the create silently fell into the coin lane and the rest of
            // this spec would pass while exercising nothing.
            expect(dispenserRow.get_tick, 'the dispenser is priced in a TOKEN').toBe('XCHAIN');
            expect(Number(dispenserRow.get_amount), 'price per fill')
                .toBeCloseTo(Number(PRICE_PER_FILL), 8);
            expect(dispenserRow.source, 'opened by the funded seller address').toBe(sellerAddress);
        });

        await test.step('buyer: onboard a SEPARATE wallet holding no XCHAIN', async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            // Read the buyer address off a FORM's source field, the same way
            // the seller's was read, so it is the address the wallet actually
            // composes from. On a wallet this fresh there is exactly one, which
            // is also the one the buy panel will pick (newest external HD).
            await gotoPalette(page, 'Issue token');
            buyerAddress = await page.getByRole('main')
                .getByLabel('From', { exact: true }).inputValue();
            expect(buyerAddress, 'the buyer wallet has a signing address')
                .toMatch(/^(bcrt1|[mn2])/);
            expect(buyerAddress, 'the buyer is a different wallet from the seller')
                .not.toBe(sellerAddress);

            // BTC only: it pays the miner fee for the mint further down. The
            // buyer must hold ZERO XCHAIN, which is the condition under test.
            await fundAddress(buyerAddress, FUNDING_BTC);
            await remount(page);

            const held = await explorerJson(`balances/${buyerAddress}`);
            const row = (held?.data || []).find((b) => b.tick === 'XCHAIN');
            expect(Number(row?.amount || 0), 'a fresh buyer holds no XCHAIN').toBe(0);
        });

        await test.step('the buy is blocked, and the panel says exactly why', async () => {
            await openDispenserAsBuyer(page, sellerAddress);

            // The buy panel exists at all, which is itself the `canBuyWithSend`
            // assertion: a token-priced dispenser this wallet does NOT own.
            const footer = page.getByTestId('buy-balance');
            await expect(footer).toHaveText('0 XCHAIN available', { timeout: 60_000 });

            const panel = page.getByTestId('preflight-panel');
            await expect(panel).toHaveAttribute('data-verdict', 'fail', { timeout: 30_000 });
            await expect(page.getByTestId('preflight-chip')).toHaveText('Will likely fail');

            // §4.2: the finding is the component's own authored sentence, with
            // the real numbers in it. Fills defaults to 1, so the total is one
            // fill's price.
            await expect(panel).toContainText(
                `This buy pays ${PRICE_PER_FILL} XCHAIN, but this address holds 0 XCHAIN.`,
            );

            // The check is funding-only and says so, rather than implying it
            // predicted the fill would land.
            await expect(page.getByTestId('preflight-restricted')).toHaveText('Partial check');
            await expect(panel).toContainText(/Only your payment-token balance was checked/i);

            // NOT overridable, unlike the network-sourced findings on Send.
            // This one is arithmetic the wallet did itself against a balance it
            // read, so there is no censorship risk to trade against - and an
            // acknowledged override here would only buy the user a rejected
            // action and a wasted network fee.
            await expect(page.getByTestId('ack-insufficient_funds')).toHaveCount(0);
            await expect(panel.getByText('Sign anyway')).toHaveCount(0);

            // `buyUnderfunded` blocking the buy, which is the fix itself.
            await expect(page.getByRole('button', { name: /^Buy 1 fill$/ })).toBeDisabled();
        });

        await test.step('funding the buyer flips the same screen to pass', async () => {
            // SENSITIVITY. Everything above is also true of a panel that
            // refuses unconditionally; only the flip distinguishes the two, and
            // an always-refusing funding gate is exactly the regression this
            // spec exists to catch.
            await remount(page);
            await mintXchain(page, BUYER_MINT);
            await waitForToken(buyerAddress, 'XCHAIN', BUYER_MINT);
            await remount(page);
            await openDispenserAsBuyer(page, sellerAddress);

            // The footer now reports the real balance, thousands separator and
            // all, so this is not a cached string. The optional zero tail is
            // tolerated because the amount's precision comes from the read path
            // rather than from this spec (a 0-decimal tick reads back as "1000"
            // today, but an aggregate lane could hand back "1000.00000000");
            // the separator and the magnitude are what carry the assertion.
            await expect(page.getByTestId('buy-balance'))
                .toHaveText(/^1,000(\.0+)? XCHAIN available$/, { timeout: 60_000 });

            const panel = page.getByTestId('preflight-panel');
            await expect(panel).toHaveAttribute('data-verdict', 'pass', { timeout: 30_000 });
            await expect(page.getByTestId('preflight-chip')).toHaveText('Looks good');

            // Still restricted: funding was all it ever checked, and a pass
            // must not start claiming the fill will land.
            await expect(page.getByTestId('preflight-restricted')).toHaveText('Partial check');

            await expect(page.getByRole('button', { name: /^Buy 1 fill$/ })).toBeEnabled();
        });
    });
});
