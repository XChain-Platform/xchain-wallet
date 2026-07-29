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

export default async function globalSetup() {
    await assertVenueReachable();

    // . Logged rather than silent: which price a run is asserting against
    // is the single fact that explains a fee number, and "already priced" vs
    // "seeded" is the difference between reading the venue's own oracle and
    // reading a fixture.
    const price = await seedPrices();
    console.log(`[regtest ${REGTEST_COIN}] price ${price.seeded ? 'seeded' : 'already on venue'}: `
        + `XCHAIN/USD ${price.xchainUsdPrice}, coin/USD ${price.coinUsdPrice} (round ${price.oracleRound})`);
}
