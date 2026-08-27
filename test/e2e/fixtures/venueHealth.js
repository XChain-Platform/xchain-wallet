// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Is the venue fit to start a spec on? The pure half of
// `assertVenueReachable`, split out of `regtest.js` for the same reason
// `priceSeed.js` is split out: the states this code exists to catch appear on a
// shared dev stack once every few weeks and never on demand, so the only honest
// way to know the guard works is to hand it a RECORDED sick payload in a unit
// test. `regtest.js` imports `@playwright/test`; this file imports nothing, so
// vitest can drive it in milliseconds.
//
// See `test/unit/e2e-venue-verdict.test.js`, which carries the real bodies.

/**
 * Given the explorer's `/api/status` body, decide whether `coin`'s pipeline is
 * fit to start a spec on. Returns null when it is, else the sentence to put in
 * front of the operator.
 *
 * `chain_lag_blocks` ALONE IS NOT ENOUGH, and a day of this campaign was spent
 * proving it. On 2026-08-11 RDOGE sat 89 blocks behind - `last_block` 2064
 * against a `chain_tip` of 2153 - while `chain_lag_blocks.RDOGE` read 0 and
 * `decoder_tip` equalled `chain_tip`. Global setup passed, every spec then
 * failed somewhere deep inside the wallet, and the venue looked innocent the
 * whole time. The endpoint publishes two heights derived independently, so
 * compare THOSE and refuse to start when they disagree.
 *
 * Order is deliberate. `decoder_health` is checked first because a dead decoder
 * makes every other field meaningless: on 2026-08-27 RBTC published
 * `chain_tip: null` and `chain_lag_blocks: null` while its decoder crash-looped
 * on a REORG_HALT marker, and the old code's "reports no RBTC chain" would have
 * sent the reader to check tunnels that were fine.
 *
 * The height comparison is LAST of the two liveness checks on purpose: a chain
 * that is merely behind (lag > 2) is a wait, while one whose indexed height
 * disagrees with the tip while reporting zero lag is a WEDGE, and the reader
 * needs to be told which.
 */
export function venueVerdict(status, coin) {
    const health = status?.decoder_health?.[coin];
    if (health && health !== 'healthy') {
        return `Regtest ${coin} decoder reports "${health}". Read that container's log for the `
            + 'remedy; this is a venue outage, not a wallet defect.';
    }

    const lag = status?.chain_lag_blocks?.[coin];
    if (typeof lag !== 'number') {
        return `Explorer answered but reports no ${coin} chain.`;
    }

    // The INDEXER height against the NODE tip. `chain_lag_blocks` is NOT this
    // subtraction - it read 0 through the whole 89-block stall above.
    const tip = status?.chain_tip?.[coin];
    const indexed = status?.last_block?.[coin];
    if (typeof tip === 'number' && typeof indexed === 'number' && tip - indexed > 2) {
        return `Regtest ${coin} is WEDGED: the chain tip is ${tip} but only ${indexed} is indexed `
            + `(${tip - indexed} blocks behind), while chain_lag_blocks reports ${lag}. `
            + 'Do not start a spec on it - the failures will point at the wallet.';
    }

    if (lag > 2) {
        return `Regtest ${coin} indexer is ${lag} blocks behind; wait for it to catch up.`;
    }

    return null;
}
