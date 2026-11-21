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
import { isChunkEncoding } from './nativeFeeLane.js';

// The idempotence scope a delivered send is booked under. The live send path
// books under the same scope and key, so bytes it already booked and a restart
// then resumes are never counted twice.
export const ADS_DELIVERY_BOOKING_SCOPE = 'queuedDelivery';

/** A verdict for a leg that carried no payout: it only accrues. */
export function accrueOnlyVerdict(verdict) {
    return { ...verdict, donationIncluded: false, donatedFiat: null, currency: null, reservationId: null };
}

/**
 * Whether a two-phase send's commit carries its custom outputs, the donation
 * among them. The chunk lane defers every one to the reveal; an envelope keeps
 * them on the commit. Read off the signed encoding, or off the progress the
 * landed commit emitted when no encoding was reported.
 *
 * @param {{ encoding?: string | null, landedPhase?: string | null }} lane
 */
export function donationRidesCommit({ encoding = null, landedPhase = null }) {
    if (typeof encoding === 'string' && encoding) return !isChunkEncoding(encoding);
    return landedPhase === 'envelope_revealing';
}

/**
 * Book the landed commit of a two-phase send as its own transaction. It settles
 * the payout only when it carried it, and is keyed beside the record id the
 * final leg books under, so neither leg is counted twice.
 *
 * @returns {Promise<{ carries: boolean, booking: {fiat: string, currency: string} | null }>}
 */
export async function bookLandedCommit({ vault, verdict, encoding, landedPhase, pendingTxId }) {
    const carries = donationRidesCommit({ encoding, landedPhase });
    const keyed = verdict.mainnet !== false && typeof pendingTxId === 'string' && pendingTxId;
    const { booking } = await commitAdsStepWithBooking({
        vault,
        ...(carries ? verdict : accrueOnlyVerdict(verdict)),
        ...(keyed ? { bookingScope: ADS_DELIVERY_BOOKING_SCOPE, bookingKey: `${pendingTxId}:commit` } : {}),
    });
    return { carries, booking };
}

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
                bookingScope: counted && bookingKey ? ADS_DELIVERY_BOOKING_SCOPE : null,
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
