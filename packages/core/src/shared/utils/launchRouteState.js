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
