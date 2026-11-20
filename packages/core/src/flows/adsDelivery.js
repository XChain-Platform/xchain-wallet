// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { stampPendingTxAdsBooking } from '../notifications/pendingTxBridge.js';
import { commitAdsStepWithBooking, settleAdsReservationWithBooking } from './ads.js';

/** Book bytes delivered by either queued-broadcast implementation. */
export async function bookQueuedDelivery({
    vault,
    chainRegistry,
    pendingTxId = null,
    adsCommit = null,
    accrue = true,
    stampBooking = stampPendingTxAdsBooking,
    onError = null,
}) {
    try {
        let booking = null;
        if (adsCommit && accrue) {
            const descriptor = chainRegistry?.get?.(adsCommit.chainId) ?? null;
            const counted = adsCommit.mainnet !== false && descriptor?.networkKind === 'mainnet';
            const bookingKey = adsCommit.bookingKey ?? null;
            ({ booking } = await commitAdsStepWithBooking({
                vault,
                donationIncluded: adsCommit.donationIncluded,
                donatedFiat: adsCommit.donatedFiat ?? null,
                currency: adsCommit.currency ?? null,
                mainnet: counted,
                reservationId: adsCommit.reservationId ?? null,
                bookingScope: counted && bookingKey ? 'queuedDelivery' : null,
                bookingKey: counted ? bookingKey : null,
            }));
        } else {
            const claim = adsCommit
                ? (typeof adsCommit.reservationId === 'string' && adsCommit.reservationId
                    ? adsCommit.reservationId : null)
                : pendingTxId;
            if (claim) ({ booking } = await settleAdsReservationWithBooking({ vault, reservationId: claim }));
        }
        if (booking && pendingTxId) await stampBooking(vault, pendingTxId, booking);
        return true;
    } catch (error) {
        if (typeof onError === 'function') onError(error);
        return false;
    }
}
