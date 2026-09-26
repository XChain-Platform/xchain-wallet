// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Global setup for the TESTNET venue: prove the public chain is reachable,
// fit, and priced before Playwright spends an hour of block time on a wallet
// that could not have completed a single action.
//
// Everything here is a READ. The regtest setup heals a clock, seeds a price
// through ssh and docker into an indexer database and issues a gas token; none
// of that exists on a public chain and none of it is attempted. The federation
// prices testnet, XCHAIN is a protocol constant there, and the chain's clock is
// the chain's. What can still be wrong is the venue in front of it (a halted
// replica, a stale explorer, a wedged indexer), and those are the states the
// check names.
//
// The treasury is NOT read here. Stdin carries a signing key and this process
// has no destination to send to yet; `fundFromTreasury` reads it in the spec,
// once, after the wallet has shown its address.

import { checkTestnetVenue, liveVenue, TESTNET_COIN, testnetEndpoints } from './fixtures/testnet.js';

export default async function globalSetup() {
    const endpoints = testnetEndpoints();
    const report = await checkTestnetVenue(liveVenue(endpoints));
    // Which price a run is asserting against is the single fact that explains
    // a fee number, so it is logged beside the height the run starts from.
    console.log(`[testnet ${TESTNET_COIN}] explorer ${endpoints.explorerUrl}: tip ${report.tip}, `
        + `indexed ${report.indexed}, tip age ${report.tipAgeSeconds}s`);
    console.log(`[testnet ${TESTNET_COIN}] priced: XCHAIN/USD ${report.price.xchainUsdPrice}, `
        + `coin/USD ${report.price.coinUsdPrice} (round ${report.price.oracleRound})`);
}
