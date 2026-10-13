// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

const FULL_LAYOUT_SHELL = 'web';
const COMPACT_LAYOUT_SHELL = 'popup';
const COMPACT_FALLBACK_MAX_WIDTH = 600;

/**
 * Select the shared route layout for an extension page. The side panel and
 * toolbar popup stay compact, while popup.html opened in a browser tab uses
 * the full layout. Width is a fallback for browsers without getViews().
 *
 * @param {Window | undefined} view
 * @param {{ getViews?: (filter: { type: string }) => Window[] }} [extensionApi]
 * @returns {'popup' | 'web'}
 */
export function shellForExtensionView(
    view = globalThis.window,
    extensionApi = globalThis.chrome?.extension,
) {
    if (!view) return COMPACT_LAYOUT_SHELL;
    if (view.location?.pathname?.endsWith('/sidepanel.html')) return COMPACT_LAYOUT_SHELL;

    try {
        if (typeof extensionApi?.getViews === 'function') {
            const popupViews = extensionApi.getViews({ type: 'popup' });
            if (Array.isArray(popupViews)) {
                return popupViews.includes(view) ? COMPACT_LAYOUT_SHELL : FULL_LAYOUT_SHELL;
            }
        }
    } catch {
        // Width remains a safe layout signal when view enumeration is unavailable.
    }

    return Number(view.innerWidth) > COMPACT_FALLBACK_MAX_WIDTH
        ? FULL_LAYOUT_SHELL
        : COMPACT_LAYOUT_SHELL;
}

/**
 * Keep an extension URI route authoritative through a locked launch. Consuming
 * the route on unlock does not release the guard: wallet activation triggers
 * last-view restoration later, so that first restoration must still be skipped.
 */
export function createLaunchRouteState() {
    let pendingView = null;
    let skipNextLastViewResume = false;

    return {
        /** @param {'send' | 'receive' | 'contract-execute'} view */
        remember(view) {
            pendingView = view;
            skipNextLastViewResume = true;
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
