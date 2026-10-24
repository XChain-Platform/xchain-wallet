// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Keep an incoming route authoritative through unlock and wallet activation.
 * An intent received by an unlocked shell applies immediately and does not
 * remain queued for a later session refresh.
 */
export function createLaunchRouteState() {
    let pendingView = null;
    let skipNextLastViewResume = false;

    return {
        /**
         * @param {'send' | 'receive' | 'contract-execute'} view
         * @param {{ state?: string } | string | null | undefined} [session]
         */
        remember(view, session) {
            const state = typeof session === 'string' ? session : session?.state;
            if (state === 'unlocked') {
                pendingView = null;
                skipNextLastViewResume = false;
                return;
            }
            pendingView = view;
            skipNextLastViewResume = true;
        },

        clear() {
            pendingView = null;
            skipNextLastViewResume = false;
        },

        /** @param {{ state?: string } | null | undefined} session */
        takeForSession(session) {
            if (session?.state !== 'unlocked' || !pendingView) return null;
            const view = pendingView;
            pendingView = null;
            return view;
        },

        shouldSkipLastViewResume() {
            return skipNextLastViewResume;
        },

        walletActivated() {
            skipNextLastViewResume = false;
        },
    };
}

/**
 * Whether a session-state change must wipe the transient screen state.
 *
 * A link opened before the wallet is unlocked parks its prefill and its view
 * while the shell is still loading or locked, so those two states must not
 * wipe what the link just parked. Leaving an unlocked session, or landing on
 * any state that is not a pre-unlock wait (no wallet, an error), wipes it.
 *
 * @param {string | undefined} previousState  session state before the change; undefined on first mount
 * @param {string} nextState
 * @returns {boolean}
 */
export function shouldClearTransientState(previousState, nextState) {
    if (nextState === 'unlocked') return false;
    const waiting = nextState === 'loading' || nextState === 'locked';
    const wasWaiting = previousState === undefined
        || previousState === 'loading'
        || previousState === 'locked';
    return !(waiting && wasWaiting);
}
