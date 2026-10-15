// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Host messages that sign a transaction and then broadcast it or persist it
// (pending record, broadcast queue entry, multisig session state). Cutting
// one of these off mid-flight can leave a broadcast transaction the wallet
// never recorded, so quit waits for them.
//
// Derived from the extension background host: every type registered through
// its hardware-signer wrapper plus the software twin of each, every handler
// that wires a broadcast-failure fallback, and the explicit broadcast and
// queue steps. Reads, quotes, compose-for-confirm previews, unsigned PSBT
// builders and sign-and-return calls are left out on purpose: they leave no
// half-written state, and counting them let any slow read block quit.
const SIGNED_ACTIONS = [
    'action.send',
    'action.sweep',
    'action.issue',
    'action.mint',
    'action.destroy',
    'action.callback',
    'action.sleep',
    'action.broadcast',
    'action.oraclePrice',
    'action.addressPrefs',
    'action.deployChunked',
    'action.dispenser',
    'action.dividend',
    'action.createList',
    'action.airdrop',
    'action.advanced',
    'action.order',
    'action.cancelOrder',
    'action.editOrder',
    'action.coinpay',
    'action.swap',
    'action.link',
    'action.file',
    'action.gatedPublish',
    'action.message',
    'messaging.handshake',
    'action.deploy',
    'action.execute',
    'action.deposit',
    'action.withdraw',
    'action.stake',
    'action.unstake',
    'action.collect',
    'action.delegate',
    'action.revokeDelegation',
    'action.createPoll',
    'action.castBallot',
    'action.delegateVote',
    'action.createMarket',
    'action.placeBet',
    'action.resolveMarket',
    'action.cancelMarket',
    'action.editBetFeedLists',
    'action.clearVoteDelegation',
    'action.contractStake',
];

export const QUIT_DEFERRING_MESSAGE_TYPES = new Set([
    ...SIGNED_ACTIONS,
    ...SIGNED_ACTIONS.map((type) => `${type}.hw`),
    'wallet.publishLabels',
    'tx.replace',
    'broadcast.signedTx',
    'broadcast.queue.broadcast',
    'broadcast.queue.enqueue',
    'multisigSign.finalize',
]);

/**
 * Whether an in-flight renderer message of this type should hold quit until
 * it settles.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isQuitDeferringMessage(message) {
    const type = /** @type {{ type?: unknown }} */ (message)?.type;
    return typeof type === 'string' && QUIT_DEFERRING_MESSAGE_TYPES.has(type);
}

// How long quit waits for counted operations. Long enough for a broadcast
// and its persistence on a slow link, short enough that a stuck network call
// or a dead connection can never keep the app from quitting.
export const QUIT_DEFER_DEADLINE_MS = 15 * 1000;

/**
 * Bound how long quit waits on counted operations.
 *
 * `request()` runs inside before-quit. It returns 'defer' for the first quit
 * that finds work in flight (the caller prevents it and may show a window),
 * 'wait' for a later quit request during the same wait (prevented as well,
 * but it neither restarts nor extends the clock), and null when quit should
 * go ahead. The wait ends at whichever comes first: `settle()` seeing no
 * counted work left, or the deadline. Either way `quit` is invoked once and
 * the before-quit it raises goes through, even if work is still running.
 *
 * @param {object} opts
 * @param {() => boolean} opts.isBusy  whether counted work is still in flight
 * @param {() => void} opts.quit  re-issue the quit (app.quit in main)
 * @param {number} [opts.deadlineMs]
 * @param {(fn: () => void, ms: number) => unknown} [opts.setTimer]
 * @param {(handle: unknown) => void} [opts.clearTimer]
 */
export function createQuitDeferral({
    isBusy,
    quit,
    deadlineMs = QUIT_DEFER_DEADLINE_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(/** @type {any} */ (handle)),
}) {
    let timer = /** @type {unknown} */ (null);
    let released = false;

    function stopTimer() {
        if (timer === null) return;
        clearTimer(timer);
        timer = null;
    }

    function release() {
        if (released) return;
        released = true;
        stopTimer();
        quit();
    }

    return {
        /** @returns {'defer' | 'wait' | null} */
        request() {
            if (released || !isBusy()) {
                stopTimer();
                return null;
            }
            if (timer !== null) return 'wait';
            timer = setTimer(release, deadlineMs);
            return 'defer';
        },
        /** Call after a counted operation finishes. */
        settle() {
            if (timer !== null && !isBusy()) release();
        },
    };
}
