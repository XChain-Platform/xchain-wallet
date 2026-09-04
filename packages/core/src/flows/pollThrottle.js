// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// pollThrottle: the one rule that decides whether a re-poll triggered by a
// focus or visibilitychange event is worth issuing.
//
// Home, History and the coinpay badge each poll on an interval and ALSO
// re-poll the moment the tab comes back, because that is exactly when a user
// goes looking for a balance. Left unguarded, one alt-tab fires `focus` and
// `visibilitychange` together, and a user flicking between windows lands two
// or three full wallet loads inside one rate-limit counting period: the
// wallet's own footprint is what makes it look like abuse (rate-limits spec,
// D-E). The interval already bounds freshness to one poll interval, so a
// re-poll is only worth anything when the data is OLDER than that.
//
// Leading edge, keyed on the LAST SUCCESSFUL poll: the first event after the
// data has aged past the interval fires at once (the alt-tab back after a
// while away stays instant); every event inside the window, and every event
// while a poll is still in flight, is dropped. A poll that fails releases the
// window so the next event may try again, rather than pinning a failure for a
// whole interval.
//
// Pure and clock-injectable so the three call sites share one rule and the
// release profiler (tools/release/cold-open-profile.mjs) can DRIVE it to
// count what an alt-tab costs instead of restating the answer.

/**
 * @typedef {Object} PollThrottle
 * @property {(atMs?: number) => boolean} due      true when no poll is in flight and the last
 *                                                 successful one is at least `intervalMs` old
 *                                                 (or there has never been one)
 * @property {(atMs?: number) => boolean} start    claim the window: true (and marks a poll in
 *                                                 flight) when due, else false; the caller polls
 *                                                 only on true
 * @property {(atMs?: number) => void} succeed     a poll landed: clears in-flight and restarts the
 *                                                 window from now. Interval polls call this too,
 *                                                 so a refocus right after the beat is dropped
 * @property {() => void} fail                     a poll failed: clears in-flight, window unchanged
 * @property {(atMs?: number) => boolean} claim    start + succeed in one step, for a poll whose
 *                                                 "success" is issuing it (History's tick bump)
 * @property {() => void} reset                    forget everything (wallet or account switch)
 * @property {() => number | null} lastSuccessAt   when the last successful poll landed, ms
 * @property {number} intervalMs
 */

/**
 * @param {number} intervalMs  the poll interval the window is keyed to (BALANCE_POLL_INTERVAL_MS
 *                             for Home and History, the badge hook's own pollMs for coinpay)
 * @param {{ now?: () => number }} [opts]  clock, injectable for tests and the profiler
 * @returns {PollThrottle}
 */
export function createPollThrottle(intervalMs, { now = () => Date.now() } = {}) {
    if (!Number.isFinite(intervalMs) || intervalMs < 0) {
        throw new Error('createPollThrottle: intervalMs must be a non-negative number');
    }
    /** @type {number | null} */
    let lastSuccessAt = null;
    let inFlight = false;
    const at = (atMs) => (Number.isFinite(atMs) ? atMs : now());

    const due = (atMs) => {
        if (inFlight) return false;
        if (lastSuccessAt === null) return true;
        return at(atMs) - lastSuccessAt >= intervalMs;
    };
    const start = (atMs) => {
        if (!due(atMs)) return false;
        inFlight = true;
        return true;
    };
    const succeed = (atMs) => {
        inFlight = false;
        lastSuccessAt = at(atMs);
    };
    const fail = () => {
        inFlight = false;
    };
    const claim = (atMs) => {
        if (!start(atMs)) return false;
        succeed(atMs);
        return true;
    };
    const reset = () => {
        inFlight = false;
        lastSuccessAt = null;
    };

    return {
        due, start, succeed, fail, claim, reset,
        lastSuccessAt: () => lastSuccessAt,
        intervalMs,
    };
}
