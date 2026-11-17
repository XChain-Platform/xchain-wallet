// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The ISSUE protocol fee read off the chain's published fee schedule, so the
// Issue token form can show it the moment it opens instead of waiting for a
// complete action to dry-run.
//
// A new top-level token costs GAS_SCHEDULE.ISSUE gas and a subtoken (a dotted
// ticker) GAS_SCHEDULE.ISSUE_SUBTOKEN, each priced at GAS_PRICE XCHAIN per gas
// (xchain-indexer actions/issue/fees.js under UNIFIED_FEES). No other ISSUE
// field adds a protocol fee. The indexer's own BATCH pre-check picks the price
// by the dot the same way (actions/batch/fees.js nominalIssueFee).
//
// The schedule comes from GET /{COIN}/api/feeschedule (sdk.getFeeSchedule),
// which the indexer publishes for exactly this: a figure before the per-action
// quote. When the oracle prices are there the native-coin figure is the same
// band midpoint the quote uses (fee x XCHAIN/USD / COIN/USD). Display only:
// review composes and quotes for real, and an existing ticker (an update, which
// is free) is answered by that live quote, not by this.

import { feeForGas, scheduleGas } from './scheduleFee.js';

/**
 * @param {*} schedule  the feeschedule answer; anything else yields null
 * @param {string} ticker  the ticker as typed; a dot selects the subtoken price
 * @returns {null | { xchainFee: string, requiredFeeSats?: number, scheduleEstimate: true }}
 */
export function issueFeeFromSchedule(schedule, ticker) {
    const key = String(ticker || '').includes('.') ? 'ISSUE_SUBTOKEN' : 'ISSUE';
    // A schedule that cannot price ISSUE fails closed, as the indexer's own
    // static pricing does: no figure beats a figure from a half-read table.
    return feeForGas(schedule, scheduleGas(schedule, key));
}
