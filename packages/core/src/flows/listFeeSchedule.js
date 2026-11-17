// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The LIST protocol fee the moment a list form opens, read off the chain's
// fee schedule (scheduleFee.js). xchain-indexer actions/list/fees.js charges:
//   format 2 (share)                    GAS_SCHEDULE.LIST_SHARE, one flat fee
//   format 1 (edit) naming a shared list's own index
//                                       LIST_SHARED_EDIT_BASE plus
//                                       LIST_SHARED_EDIT_PER_ITEM per item
//                                       actually added or removed
//   format 5 (name and description) on a shared list
//                                       LIST_SHARED_EDIT_BASE
//   everything else (create, fork copy, union create, transfer, any edit of
//   an unshared list)                   nothing
// so every list form knows its fee before review: the share and shared-edit
// figures from the schedule, the rest as free.

import { t } from '../i18n/index.js';
import '../i18n/locales/en/flows.js';
import { formatWithThousands } from '../shared/utils/amountFormat.js';
import { normalizeProtocolFee } from './protocolFeeRow.js';
import { baseItemFeeFromSchedule } from './scheduleFee.js';

/**
 * The Share page's "Share fee" row: the fee in XCHAIN, grouped and with every
 * significant place kept, then its fiat value ("1 XCHAIN ~$0.25"). With no
 * price the XCHAIN amount stands alone; a fiat figure is never guessed.
 * Calculating while the schedule loads, Priced at review only when neither
 * the schedule nor a live quote could price it.
 *
 * @param {{ quote: *, pending?: boolean, formatFiat?: ((xchain: string) => string | null) | null }} opts
 * @returns {string}
 */
export function shareFeeRowText({ quote, pending = false, formatFiat = null }) {
    const fee = normalizeProtocolFee(quote);
    if (fee.free) return t('flows.feesCard.free');
    if (!fee.known || fee.amount === null) {
        return pending ? t('flows.feesCard.calculating') : t('flows.feesCard.pricedAtReview');
    }
    const xchain = `${formatWithThousands(fee.amount) || fee.amount} XCHAIN`;
    const fiat = typeof formatFiat === 'function' ? formatFiat(fee.amount) : null;
    return fiat ? `${xchain} ${fiat}` : xchain;
}

/** The flat share fee (LIST format 2). */
export function listShareFeeFromSchedule(schedule) {
    return baseItemFeeFromSchedule(schedule, { baseKey: 'LIST_SHARE' });
}

/**
 * A shared list's edit fee over the charged transactions: one count per
 * transaction of the items it adds or removes ([0] for a memo-only or
 * name-and-description change). Only an edit naming the shared list's own
 * index pays (isListShared(LIST_ACTION_INDEX)), so the second transaction of
 * an add-then-remove, which names the first one's new index, is not counted.
 *
 * @param {*} schedule
 * @param {number[]} itemsPerTransaction
 */
export function listSharedEditFeeFromSchedule(schedule, itemsPerTransaction) {
    return baseItemFeeFromSchedule(schedule, {
        baseKey: 'LIST_SHARED_EDIT_BASE',
        perItemKey: 'LIST_SHARED_EDIT_PER_ITEM',
        items: itemsPerTransaction,
    });
}
