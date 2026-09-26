// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What the detail page says, and offers, once a dispenser is over.
//
// The indexer refuses a close or edit (Refill is an edit) unless the
// dispenser's status is `open` (xchain-indexer actions/dispenser/index.js,
// checkDispenserAuthority), and a drained dispenser goes straight to `empty`
// at the fill that drains it, with no close window (actions/dispense/settle.js).
// So on these statuses Close / Refill / Edit can never succeed, and showing
// them disabled only raised the question of when they would come back. They
// never do. What the owner CAN do is open a new dispenser on the same address:
// the creator keeps origin standing there permanently (dispenser.md, Rules c).

import { boundListIndex } from '../../flows/accessListSlots.js';

// `closed` and `complete` are not written by the indexer today; they are the
// spellings older explorers and the demo fixtures use for the same end state,
// and DispensersList already treats them as terminal.
const NOTICES = {
    empty: {
        what: 'This dispenser sold out.',
        rule: "Sold-out dispensers can't be refilled",
    },
    complete: {
        what: 'This dispenser sold out.',
        rule: "Sold-out dispensers can't be refilled",
    },
    max_dispenses_reached: {
        what: 'This dispenser reached its 1,000-dispense limit and closed. Any escrow left went back to the owner.',
        rule: "A closed dispenser can't be refilled",
    },
    // A cancel returns escrow to whichever owner address closed it, or to a
    // SWEEP destination, so this copy does not name where it went.
    cancelled: {
        what: 'This dispenser was closed and any escrow left was returned.',
        rule: "A closed dispenser can't be reopened",
    },
    closed: {
        what: 'This dispenser was closed and any escrow left was returned.',
        rule: "A closed dispenser can't be reopened",
    },
    expired: {
        what: 'This dispenser expired. Any escrow left went back to the owner.',
        rule: "An expired dispenser can't be refilled",
    },
};

/**
 * Whether a live dispenser status is one no owner action can move again.
 * `cancelling` is deliberately absent: the close window is still running and
 * its own banner explains it.
 *
 * @param {string} status  dispenserLiveState(...).status
 * @returns {boolean}
 */
export function isTerminalDispenserStatus(status) {
    return Object.prototype.hasOwnProperty.call(NOTICES, String(status || ''));
}

/**
 * The plain-text explanation for a terminal dispenser, or null.
 *
 * The "open a new one" clause is for the owner only: a visitor has no
 * standing on the address, so telling them they can reuse it would be wrong.
 *
 * @param {string} status
 * @param {{ canReopen: boolean }} opts
 * @returns {string | null}
 */
export function terminalDispenserNotice(status, { canReopen }) {
    const notice = NOTICES[String(status || '')];
    if (!notice) return null;
    return canReopen
        ? `${notice.what} ${notice.rule}, but you can open a new one on the same address.`
        : `${notice.what} ${notice.rule}.`;
}

// Explorer amounts arrive as fixed-scale decimals ("25.00000000"). The form
// validates fiat amounts to two places, so the padding would be refused there.
function plainDecimal(v) {
    if (v == null || v === '') return '';
    const s = String(v).trim();
    if (!/^\d+\.\d+$/.test(s)) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
}

function isZero(v) {
    const s = plainDecimal(v);
    return s === '' || s === '0';
}

/**
 * The DispenserForm prefill that opens this dispenser again: same terms, same
 * creator as SOURCE, same dispenser address.
 *
 * SOURCE must be the creator, not merely any wallet address: reusing an
 * address that already hosted a dispenser is allowed only to the address that
 * opened the first one there (origin standing), so any other SOURCE is
 * refused on chain.
 *
 * Expiration carries over only while it is still in the future; a past one
 * would be refused by the form, and on an `expired` dispenser it always is.
 *
 * @param {any} dispenser  the detail page's dispenser row
 * @param {{ expiration: any, allowList: any, blockList: any }} live  dispenserLiveState(dispenser)
 * @param {{ chainId: string, nowSeconds?: number }} opts
 */
export function reopenTermsFrom(dispenser, live, { chainId, nowSeconds = Math.floor(Date.now() / 1000) }) {
    const source = dispenser?.source || '';
    const getTick = dispenser?.get_tick || '';
    const fiatCode = dispenser?.fiat || dispenser?.fiat_code || '';
    const oracleAddress = dispenser?.oracle_address || '';
    const fiatAmount = plainDecimal(dispenser?.fiat_amount);
    const expiration = Number(live?.expiration);
    let pricing;
    if (getTick) {
        pricing = { payWith: 'token', getTick, getTokenAmount: plainDecimal(dispenser?.get_amount) };
    } else if (fiatCode && (oracleAddress || fiatAmount)) {
        // GET_AMOUNT on a fiat-priced dispenser is the protocol's 0
        // placeholder, not a price; carrying it would fill Trigger price with 0.
        pricing = { payWith: 'coin', fiatCode, fiatAmount: oracleAddress ? '' : fiatAmount, oracleAddress };
    } else {
        pricing = { payWith: 'coin', triggerPrice: isZero(dispenser?.get_amount) ? '' : plainDecimal(dispenser?.get_amount) };
    }
    return {
        chainId,
        tick: String(dispenser?.give_tick || '').toUpperCase(),
        giveAmount: plainDecimal(dispenser?.give_amount),
        escrow: plainDecimal(dispenser?.give_escrow),
        ...pricing,
        expiration: Number.isFinite(expiration) && expiration > nowSeconds ? expiration : null,
        allowList: boundListIndex(live?.allowList) || '',
        blockList: boundListIndex(live?.blockList) || '',
        source,
        dispenserAddress: dispenser?.address || dispenser?.get_address || source,
    };
}
