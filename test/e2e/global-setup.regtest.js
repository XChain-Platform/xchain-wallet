// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Global setup for the regtest venue: prove the chain is there, and that it can
// price an action, before Playwright spends two minutes onboarding a wallet
// against neither.
//
// Both checks exist for the same reason. A down SSH tunnel otherwise surfaces as
// a spec timing out deep in the send flow, and missing price state surfaces as a
// confirm screen refusing with "The LTC fee price is temporarily unavailable" -
// and both read exactly like a wallet regression. Fail here instead, once, with
// the cause named.
//
// Order matters: `seedPrices` talks to the explorer and the miner, so it would
// report a down tunnel as a price problem if it ran first.

import { assertVenueReachable, seedPrices, REGTEST_COIN } from './fixtures/regtest.js';
import { startPriceKeeper } from './fixtures/priceKeeper.js';

export default async function globalSetup() {
    await assertVenueReachable();

    //Logged rather than silent: which price a run is asserting against
    // is the single fact that explains a fee number, and "already priced" vs
    // "seeded" is the difference between reading the venue's own oracle and
    // reading a fixture.
    const price = await seedPrices();
    // The margin rides along because a fee-bearing spec that dies on "no current
    // oracle price" looks exactly like a product regression until you know how
    // much chain life the quote had when the run started.
    const margin = Number.isFinite(price.marginSeconds) ? `, ${price.marginSeconds}s of chain life left` : '';
    console.log(`[regtest ${REGTEST_COIN}] price ${price.seeded ? 'seeded' : 'already on venue'}: `
        + `XCHAIN/USD ${price.xchainUsdPrice}, coin/USD ${price.coinUsdPrice} (round ${price.oracleRound})${margin}`);

    // A seed checked ONCE is not a priced venue, it is a priced first minute.
    // The margin is spent in chain seconds and a chain that mines on demand can
    // burn thousands of them in one block, so a whole-suite run outlives its own
    // seed: measured on the second Litecoin suite run, five of nine failures
    // carried "The LTC fee price is temporarily unavailable" on screen, all of
    // them between the setup seed and the first `dispensers/` spec, which
    // repairs the price for everyone downstream by accident. See priceKeeper.js.
    const keeper = startPriceKeeper({ seed: seedPrices, log: console.log, warn: console.warn });
    return () => {
        const stats = keeper.stop();
        // Printed even when it is all zeros: how many times a run had to be
        // rescued is the first thing to know when comparing two suite numbers.
        console.log(`[price keeper] ${stats.reseeds} re-seed(s) over ${stats.ticks} check(s)`
            + `, ${stats.failures} failure(s), ${stats.skipped} skipped`);
    };
}
