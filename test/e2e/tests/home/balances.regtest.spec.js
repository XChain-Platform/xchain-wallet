// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home / balances, against a real chain (campaign §5 "Home / balances").
//
// WHAT WAS MISSING. Home's coin figure had been eyeballed - a session read
// "Bitcoin BTC 2.99997535" off the screen and called the display fixed - but
// nothing ever compared that number to the chain it claims to be reporting.
// A balance read off the screen and checked against the same screen proves
// only that the screen is self-consistent, which is exactly what a formatting
// bug, a wrong-address sum or a stale cache all are. So every figure asserted
// below is compared against TWO things the wallet never sees:
//
//   1. the amount handed to the regtest miner (the money that went in), and
//   2. `/{COIN}/api/address/{addr}` on the explorer (what the chain says is
//      there now).
//
// A fresh wallet's address holds nothing, which is asserted before funding, so
// "equals the amount we paid in" is a sound identity rather than a coincidence
// on an address that already had a balance.
//
// THE FUNDED AMOUNT IS SATOSHI-PRECISE ON PURPOSE (12.34567891 DOGE). A round
// number cannot tell a correct 8-decimal render from a truncating or rounding
// one, and D-14-class scaling bugs (a balance divided by 1e8) are the failure
// this surface has actually shipped before.
//
// VENUE: Dogecoin regtest. Two things follow from that and both are load-
// bearing. Home lists every chain the wallet has an address on, so the DOGE row
// has to be addressed explicitly rather than assumed to be the only one; and
// Receive opens on whichever chain the wallet lists FIRST, which is not
// necessarily this one - hence `receiveAddressFor`, which drives the real
// picker instead of trusting the default. A Bitcoin-regtest P2PKH address and a
// Dogecoin-regtest one are byte-identical in shape (both `[mn2]`), so a shape
// check cannot catch the wrong-chain address; only asking for the chain by name
// can.
//
// NOT DRIVEN HERE, deliberately: the LTC and BTC chains are left untouched
// (read-only). Another session drives one of them at the same time on this
// shared venue, and funding or mining there would perturb a neighbour's run.
// The multi-coin test therefore proves each chain's row against that chain's
// own explorer reading, which is a real per-chain comparison, with only DOGE
// carrying a balance.
//
// STILL OPEN, and why. The Tokens tab with a REAL holding is the obvious next
// case here (XCHAIN is free-mintable on regtest, and `decimals: 0` on this
// venue makes it the only place the whole-unit render is exercised). It was
// attempted and is NOT included, because it cannot be driven honestly right
// now: `waitForTokenBalance` mines a block on every poll pass and does not go
// through `nudgeChain`, so 120s of polling put ~80 empty blocks on the chain
// and left the RDOGE indexer stalled at block 2064 with the tip at 2148. The
// mint itself confirmed (the funding address debited 0.001 DOGE), but no
// action was ever recorded, so nothing on the Tokens tab could be compared to
// anything. Adding it back needs a healthy RDOGE indexer and a poll that
// nudges rather than floods.

import { createWallet, expect, gotoSection, test, unlockedShell } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_COIN,
    explorerJson,
    fundAddress,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';
import { VENUE_PRICE } from '../../fixtures/priceSeed.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const PASSWORD = 'regtestpassword123';

// Satoshi-precise, and large enough to clear Dogecoin's 0.01 dust floor by
// three orders of magnitude so no dust rule can collapse the row.
const FUNDING_DOGE = 12.34567891;

/**
 * The three regtest chains a wallet switched to this network holds an address
 * on, keyed by the `data-balance-key` their Home row carries
 * (`${chainId}:${tick}`, set by `BalanceList`).
 */
const CHAINS = [
    { coin: 'RBTC', chainId: 'bitcoin-regtest', tick: 'BTC', label: 'Bitcoin' },
    { coin: 'RLTC', chainId: 'litecoin-regtest', tick: 'LTC', label: 'Litecoin' },
    { coin: 'RDOGE', chainId: 'dogecoin-regtest', tick: 'DOGE', label: 'Dogecoin' },
];

const VENUE_CHAIN = CHAINS.find((c) => c.coin === REGTEST_COIN);
if (!VENUE_CHAIN) {
    throw new Error(`home/balances: no chain row mapping for XC_REGTEST_COIN=${REGTEST_COIN}`);
}

/**
 * The chain's own answer to "what does this address hold", as the decimal
 * string the explorer publishes.
 *
 * `/api/address/` is the NATIVE coin read (sourced from the utxo-tracker);
 * `/api/balances/` is the XChain TOKEN ledger and never carries the coin, so a
 * native assertion written against it would compare a screen figure to an empty
 * list and pass on anything.
 */
async function chainConfirmed(coin, address) {
    const res = await fetch(`${EXPLORER_URL}/${coin}/api/address/${address}`, {
        signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json();
    const confirmed = body?.balances?.confirmed;
    expect(
        typeof confirmed,
        `explorer ${coin} reported no confirmed balance for ${address}: ${JSON.stringify(body).slice(0, 300)}`,
    ).toBe('string');
    return String(confirmed);
}

/**
 * The venue's own finalized COIN/USD oracle price, read over the same public
 * endpoint `flows/priceLookup.js` reads.
 *
 * Read rather than taken from the fixture constant so the fiat expectation
 * below is derived from what this venue actually publishes; the fixture value
 * is only used to catch a venue that is publishing something else entirely.
 */
async function venueCoinUsdPrice() {
    const pair = VENUE_PRICE[REGTEST_COIN].coinPair;
    // Through the fixture reader, which THROWS on a refusal. The line under it
    // read `Array.isArray(body?.data) ? body.data : []`, so this endpoint
    // answering HTTP 500 in one millisecond produced "the venue publishes no
    // finalized round" and sent two runs to look at seeding. On RLTC it is
    // still 500ing: `No co-located hub DB configured for coin RLTC`, which is a
    // venue configuration gap and answers fine on RDOGE.
    const body = await explorerJson('price_snapshots/FINALIZED/status?limit=25');
    const rows = Array.isArray(body?.data) ? body.data : [];
    const row = rows.find((r) => r && r.coin_pair === pair);
    expect(row, `the venue publishes no finalized ${pair} round; global setup seeds one, so this is venue state`)
        .toBeTruthy();
    const price = Number(row.price);
    expect(Number.isFinite(price) && price > 0, `unusable ${pair} price: ${row.price}`).toBe(true);
    return price;
}

/** `BalanceList.formatAmount` for an 8-decimal coin, from a decimal string. */
function formatCoin(decimal) {
    const [whole, frac = ''] = String(decimal).trim().split('.');
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac.slice(0, 8).padEnd(8, '0')}`;
}

/** The `data-balance-key` a row carries: `${chainId}:${tick}`. */
function rowKey(chain) {
    return `${chain.chainId}:${chain.tick}`;
}

/** The Home row for one chain's native coin. */
function coinRow(page, chain) {
    return page.locator(`[data-balance-key="${rowKey(chain)}"]`);
}

/**
 * The quantity a balance row is displaying, or null while it has not painted
 * one yet.
 *
 * Read as a WHOLE LINE rather than with `toContainText`: a substring check for
 * "12.34567891" also passes on "112.34567891", which is the precise class of
 * error (a sum over the wrong address set) this spec exists to catch. A row
 * renders name / subtitle / quantity / fiat as separate blocks, and only the
 * quantity is bare digits - the subtitle carries the tick, and an unpriced row
 * renders its fiat cell empty - so the numeric line is unambiguous.
 *
 * Anchored on the text rather than on the `qty` class because the class name is
 * hashed by the CSS-module build; the row shape is app behaviour, the hash is a
 * build detail.
 */
async function displayedQuantity(page, key) {
    const row = page.locator(`[data-balance-key="${key}"]`);
    if (await row.count() === 0) return null;
    const line = (await row.innerText())
        .split('\n')
        .map((s) => s.trim())
        .find((s) => /^[\d,]+(?:\.\d+)?$/.test(s));
    return line ?? null;
}

/**
 * The wallet's own receive address FOR A NAMED CHAIN, via the real picker.
 *
 * Receive opens on the first chain the wallet lists, so on any venue but that
 * one the address it shows belongs to a different chain - and on regtest every
 * chain's P2PKH addresses share a shape, so nothing about the string itself
 * would give that away. Funding the wrong one produces a Home row that reads
 * zero while the chain reads the funded amount: a failure that looks exactly
 * like the display bug this spec is testing for.
 */
async function receiveAddressFor(page, chain) {
    await gotoSection(page, 'Receive');

    const field = page.getByLabel('Address', { exact: true });
    await expect(field, 'Receive rendered no Address field').toBeVisible({ timeout: 30_000 });
    await expect(field).toHaveValue(/^[a-zA-Z0-9]{20,}$/, { timeout: 30_000 });

    const tokenField = page.getByRole('button', { name: /^Token: / });
    await expect(tokenField, 'Receive rendered no Token field to pick a chain with')
        .toBeVisible({ timeout: 30_000 });

    if (!((await tokenField.getAttribute('aria-label')) || '').includes(`on ${chain.label}`)) {
        const before = await field.inputValue();
        await tokenField.click();

        const pick = coinRow(page, chain);
        await expect(pick, `the receive picker offered no ${chain.tick} row on ${chain.label}`)
            .toBeVisible({ timeout: 30_000 });
        await pick.click();

        await expect(tokenField).toHaveAttribute('aria-label', new RegExp(`on ${chain.label}$`), { timeout: 30_000 });
        // The address is fetched per chain AFTER the switch lands, so reading
        // it too early hands back the previous chain's address - the wrong-chain
        // funding failure above, arrived at from the other direction. Every
        // chain derives from its own SLIP-44 coin type, so the value must move.
        await expect(field, 'the Address field kept the previous chain\'s address after switching')
            .not.toHaveValue(before, { timeout: 30_000 });
    }

    return field.inputValue();
}

test.describe('Home balances against the chain', () => {
    /** @type {string} */ let address;
    /** @type {number} */ let coinUsd;

    test.beforeEach(async ({ page }) => {
        // Read the venue's price BEFORE any UI work. The fiat test below is
        // pinned `test.fail()`, and an expected-failure absorbs a setup failure
        // silently; doing this here means a venue with no oracle round reds the
        // two unpinned tests loudly instead of hiding inside the pinned one.
        coinUsd = await venueCoinUsdPrice();

        await createWallet(page, { password: PASSWORD });
        await switchToRegtest(page, PASSWORD);

        address = await receiveAddressFor(page, VENUE_CHAIN);

        // "Equals what we paid in" is only an identity on an address that held
        // nothing first. Assert that rather than assume it: HD derivation is
        // seeded randomly per wallet, but a collision with a funded address
        // would silently turn every figure below into an approximation.
        expect(
            Number(await chainConfirmed(VENUE_CHAIN.coin, address)),
            `fresh wallet address ${address} already holds coin`,
        ).toBe(0);

        await fundAddress(address, FUNDING_DOGE);

        // Balances are fetched per chain on mount; a reload is the cheapest way
        // to make the freshly-confirmed UTXO visible without reaching into app
        // internals.
        await page.reload();
        await unlockAfterReload(page, PASSWORD);
        await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });
    });

    test('the funded coin row states the chain\'s balance, to the satoshi', async ({ page }) => {
        // The chain's own record, and the money that went in. Neither number
        // comes from the wallet.
        const onChain = await chainConfirmed(VENUE_CHAIN.coin, address);
        expect(Number(onChain), 'the funding never reached the chain').toBeCloseTo(FUNDING_DOGE, 8);
        const expected = formatCoin(onChain);

        const row = coinRow(page, VENUE_CHAIN);
        await expect(row, `Home shows no ${VENUE_CHAIN.tick} row for ${VENUE_CHAIN.label}`)
            .toBeVisible({ timeout: 60_000 });

        // Polled, not waited on: the row paints before the balance fetch lands,
        // so the first render legitimately reads 0.00000000. The assertion is
        // still exact - it is the arrival that is asynchronous, not the value.
        await expect
            .poll(() => displayedQuantity(page, rowKey(VENUE_CHAIN)), {
                timeout: 90_000,
                message: `Home never displayed the chain balance ${expected} for ${address}`,
            })
            .toBe(expected);

        // And say it in the other direction too: the figure on screen is the
        // amount handed to the miner, not merely something the explorer agrees
        // with. A wallet and an explorer can be wrong together (a shared
        // scaling convention); the miner's input cannot be talked into it.
        const shown = Number((await displayedQuantity(page, rowKey(VENUE_CHAIN))).replace(/,/g, ''));
        expect(shown, 'the displayed balance is not the amount that was paid in')
            .toBeCloseTo(FUNDING_DOGE, 8);
    });

    test('every activated chain\'s row reports that chain, not another', async ({ page }) => {
        // The multi-coin residual: three chains on one screen, each row proved
        // against ITS OWN chain's explorer, using the address the wallet itself
        // hands out for that chain. A row summing the wrong chain's address, or
        // one chain's balance leaking into another's row, fails here; a spec
        // that only ever looked at the funded chain could not see either.
        /** @type {Record<string, string>} */
        const addresses = {};
        for (const chain of CHAINS) {
            addresses[chain.chainId] = await receiveAddressFor(page, chain);
        }

        // Distinct addresses per chain is the premise of the whole comparison:
        // if two chains shared one, the readings would agree for the wrong
        // reason.
        expect(new Set(Object.values(addresses)).size, `chains share an address: ${JSON.stringify(addresses)}`)
            .toBe(CHAINS.length);

        await gotoSection(page, 'Home');
        await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });

        for (const chain of CHAINS) {
            const onChain = await chainConfirmed(chain.coin, addresses[chain.chainId]);
            const expected = formatCoin(onChain);

            await expect(coinRow(page, chain), `Home shows no ${chain.tick} row for ${chain.label}`)
                .toBeVisible({ timeout: 60_000 });
            await expect
                .poll(() => displayedQuantity(page, rowKey(chain)), {
                    timeout: 90_000,
                    message: `the ${chain.label} row does not match ${chain.coin}'s reading of `
                        + `${addresses[chain.chainId]} (${expected})`,
                })
                .toBe(expected);
        }

        // Not vacuous: exactly one chain carries money, so the three rows are
        // not agreeing by all being zero.
        expect(Number(await chainConfirmed(VENUE_CHAIN.coin, addresses[VENUE_CHAIN.chainId])))
            .toBeCloseTo(FUNDING_DOGE, 8);
    });

    // PINNED KNOWN DEFECT - expected to FAIL, and it flips this suite red the
    // moment somebody fixes it, which is the signal wanted.
    //
    // Home's hero reads "$0.00 USD" over a funded wallet, and the campaign's
    // residual attributes that to the regtest venue having no coin/USD quote.
    // That diagnosis is wrong, and the difference matters because it says the
    // hero is broken on MAINNET too:
    //
    //   * The venue DOES price this coin. `venueCoinUsdPrice()` above reads a
    //     finalized DOGE/USD round off the same public endpoint
    //     `flows/priceLookup.js` uses, and the beforeEach fails if it is absent.
    //   * The hero is `sumFiatValue(rows)` over `buildBalanceRows`, which takes
    //     each row's rate from `balances.native.fiatRate` /
    //     `balances.tokens[].fiatRate`. NOTHING on the real balance path ever
    //     sets that field: `flows/balances.js` builds `{ tick, quantity,
    //     divisibility }` from `/address/` and `{ tick, quantity, divisibility,
    //     displayName, imageUrl }` from `/balances/`. The only producers of a
    //     non-null `fiatRate` in the tree are `flows/demoFixtures.js` and
    //     `packages/web/src/devFakeBalances.js`.
    //   * So every row is unpriced, the sum is 0, and `formatFiatAmount(0)`
    //     renders "$0.00" - a confident statement that the wallet is empty,
    //     rather than the "no price data" the state actually is. The wallet has
    //     a working rate source (`useFiatRate` / `priceLookup`) and Send,
    //     Receive and History all use it; Home is simply not wired to it.
    //
    // Asserted here as the CORRECT behaviour (hero = balance x the venue's own
    // published rate) so this becomes the acceptance test for the fix rather
    // than a description of the bug.
    test.fail('the fiat total is derived from the balance and the published price', async ({ page }) => {
        const onChain = Number(await chainConfirmed(VENUE_CHAIN.coin, address));
        const expectedUsd = onChain * coinUsd;
        // `formatFiat`'s shape: 2 decimals, thousands-grouped.
        const expected = `$${expectedUsd.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })}`;

        const hero = unlockedShell(page);
        // The shell is the far side of a derivation whichever name it is held
        // under, so it takes the shared KDF budget like the two waits above.
        // The poll that follows is a different wait: by then the shell has
        // painted and what is outstanding is a price round trip.
        await expect(hero).toBeVisible({ timeout: kdfStepTimeout() });

        await expect
            .poll(async () => ((await hero.innerText()).match(/\$[\d,]+\.\d{2}/) || [null])[0], {
                timeout: 60_000,
                message: `hero never showed a fiat total; expected ${expected} `
                    + `(${onChain} ${VENUE_CHAIN.tick} x ${coinUsd} USD)`,
            })
            .toBe(expected);
    });
});
