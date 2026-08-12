// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Panic-mode disclosure policy.
//
// The freeze itself is enforced in `flows/panicMode.js` and works: signing is
// refused at `assertSigningAllowed`. The defect this module fixes is that the
// refusal used to arrive only when the user pressed Approve & Sign. Home
// showed nothing, Send opened normally and quoted the full spendable balance,
// and the confirm screen said "Wallet unlocked. No password needed." -- the
// exact opposite of the truth about this wallet's ability to sign.
//
// The fix is not simply "add a banner", because panic mode has two very
// different origins:
//
//   self-armed    the user pressed Activate in Settings -> Safety. They chose
//                 this and are the only audience. Say so plainly, early, on
//                 every surface they might start a spend from.
//   duress-armed  the duress passphrase armed it while someone was watching
//                 the user unlock. That flow's stated contract is that it
//                 "silently arms panic mode without giving the observer any
//                 visible cue". A banner on Home would break exactly the
//                 protection the user reached for.
//
// So ambient surfaces (Home, the Send form) disclose ONLY a self-armed
// freeze. The sign surface is different: there the wallet was actively
// asserting it could sign. A false reassurance is not neutral cover, and a
// missing line is not a cue an observer can read, so on the sign surface both
// origins suppress the "ready to sign" claim and only a self-armed freeze
// adds an explanation in its place.
//
// Everything here is pure: `panicFreezeNotice` takes a state + clock and
// returns what to render. The React binding lives in PanicFreezeNotice.jsx.

import {
    PANIC_ARMED_SELF,
    getPanicRemainingMs,
    isSigningFrozen,
} from '../../flows/panicMode.js';

/** Surfaces the policy knows about. */
export const PANIC_SURFACE_HOME = 'home';
export const PANIC_SURFACE_SEND = 'send';
export const PANIC_SURFACE_SIGN = 'sign';

/**
 * Human countdown, matching the Settings -> Safety row so the two surfaces
 * never disagree about how long is left.
 *
 * @param {number} ms
 * @returns {string} e.g. "23h 55m", "42m"
 */
export function formatPanicRemaining(ms) {
    const totalMin = Math.max(0, Math.ceil(ms / 60_000));
    if (totalMin < 60) return `${totalMin}m`;
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

/**
 * @typedef {Object} PanicNotice
 * @property {true} frozen        signing will be refused right now
 * @property {boolean} disclose   whether this surface may say so out loud
 * @property {'self'|'duress'} armedBy
 * @property {number} remainingMs
 * @property {string} remainingText
 * @property {string|null} title  null when `disclose` is false
 * @property {string|null} detail null when `disclose` is false
 */

/**
 * What a surface should show about an active signing freeze.
 *
 * Returns `null` when nothing is frozen, so callers can render the result
 * directly. A non-null result with `disclose: false` still means "frozen":
 * the sign surface must use it to withdraw its "ready to sign" claim even
 * though it stays quiet about the reason.
 *
 * @param {object} [opts]
 * @param {import('../../flows/panicMode.js').PanicModeState} [opts.state]
 * @param {number} [opts.nowMs]
 * @param {'home'|'send'|'sign'} [opts.surface]
 * @returns {PanicNotice|null}
 */
export function panicFreezeNotice({ state, nowMs = Date.now(), surface = PANIC_SURFACE_HOME } = {}) {
    if (!state || !isSigningFrozen(state, nowMs)) return null;

    const remainingMs = getPanicRemainingMs(state, nowMs);
    const armedBy = state.armedBy === PANIC_ARMED_SELF ? PANIC_ARMED_SELF : 'duress';
    const disclose = armedBy === PANIC_ARMED_SELF;
    const remainingText = formatPanicRemaining(remainingMs);

    const base = {
        frozen: /** @type {true} */ (true),
        disclose,
        armedBy,
        remainingMs,
        remainingText,
    };
    if (!disclose) return { ...base, title: null, detail: null };
    return { ...base, ...discloseCopy(surface, remainingText) };
}

/**
 * Surface-specific wording for a self-armed freeze. Plain language: say what
 * cannot happen, how long for, and where to undo it.
 *
 * @param {string} surface
 * @param {string} remainingText
 * @returns {{ title: string, detail: string }}
 */
function discloseCopy(surface, remainingText) {
    if (surface === PANIC_SURFACE_SEND) {
        return {
            title: 'Panic mode is on. This send cannot be signed.',
            detail: `Signing stays frozen for another ${remainingText}. You can fill in the form, but approving it will be refused. Turn panic mode off in Settings > Safety to send now.`,
        };
    }
    if (surface === PANIC_SURFACE_SIGN) {
        return {
            title: 'Panic mode is on. Signing is frozen.',
            detail: `${remainingText} remaining. Approving will be refused until panic mode is turned off in Settings > Safety.`,
        };
    }
    return {
        title: 'Panic mode is on. Signing is frozen.',
        detail: `Nothing can be sent or signed for another ${remainingText}. Balances and history still work. Turn it off in Settings > Safety.`,
    };
}
