// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { createLaunchRouteState } from '@xchain-wallet/core/shared/utils/launchRouteState.js';

export { createLaunchRouteState };

const FULL_LAYOUT_SHELL = 'web';
const COMPACT_LAYOUT_SHELL = 'popup';
const COMPACT_FALLBACK_MAX_WIDTH = 600;
const HANDOFF_FLOWS = new Set(['backup', 'hardware', 'import']);

/**
 * Identify the toolbar popup without mistaking the side panel or a narrow tab
 * for it. View enumeration is authoritative when the browser exposes it.
 *
 * @param {Window | undefined} view
 * @param {{ getViews?: (filter: { type: string }) => Window[] }} [extensionApi]
 */
export function isToolbarPopupView(
    view = globalThis.window,
    extensionApi = globalThis.chrome?.extension,
) {
    if (!view || view.location?.pathname?.endsWith('/sidepanel.html')) return false;
    try {
        if (typeof extensionApi?.getViews === 'function') {
            const popupViews = extensionApi.getViews({ type: 'popup' });
            if (Array.isArray(popupViews)) return popupViews.includes(view);
        }
    } catch {
        // A narrow popup.html view is the fallback when enumeration is unavailable.
    }
    return view.location?.pathname?.endsWith('/popup.html')
        && Number(view.innerWidth) <= COMPACT_FALLBACK_MAX_WIDTH;
}

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
            return isToolbarPopupView(view, extensionApi)
                ? COMPACT_LAYOUT_SHELL
                : FULL_LAYOUT_SHELL;
        }
    } catch {
        // Width remains a safe layout signal when view enumeration is unavailable.
    }

    return Number(view.innerWidth) > COMPACT_FALLBACK_MAX_WIDTH
        ? FULL_LAYOUT_SHELL
        : COMPACT_LAYOUT_SHELL;
}

/**
 * Read a validated popup handoff. Only navigation state crosses into the URL;
 * recovery phrases, files, and passwords remain in the originating document.
 *
 * @param {string} search
 * @returns {{ flow: 'backup' | 'hardware' | 'import', mode?: 'fresh' | 'add', variant?: 'default' | 'freewallet', lane?: 'mnemonic' | 'backup' } | null}
 */
export function parseExtensionHandoff(search) {
    const params = new URLSearchParams(search || '');
    const flow = params.get('handoff');
    if (!HANDOFF_FLOWS.has(flow)) return null;
    if (flow !== 'import') return { flow };
    return {
        flow,
        mode: params.get('mode') === 'add' ? 'add' : 'fresh',
        variant: params.get('variant') === 'freewallet' ? 'freewallet' : 'default',
        lane: params.get('lane') === 'backup' ? 'backup' : 'mnemonic',
    };
}

/**
 * Open a roomier extension tab and close the source only when it is the real
 * toolbar popup and tab creation succeeds.
 *
 * @param {{ flow: 'backup' | 'hardware' | 'import', mode?: 'fresh' | 'add', variant?: 'default' | 'freewallet', lane?: 'mnemonic' | 'backup' }} handoff
 * @param {{ chromeApi?: typeof chrome, view?: Window }} [options]
 * @returns {Promise<boolean>}
 */
export async function openExtensionTab(handoff, options = {}) {
    const chromeApi = options.chromeApi || globalThis.chrome;
    const view = options.view || globalThis.window;
    if (!HANDOFF_FLOWS.has(handoff?.flow)
        || typeof chromeApi?.runtime?.getURL !== 'function'
        || typeof chromeApi?.tabs?.create !== 'function') {
        return false;
    }

    try {
        const url = new URL(chromeApi.runtime.getURL('popup.html'));
        url.searchParams.set('handoff', handoff.flow);
        if (handoff.flow === 'import') {
            url.searchParams.set('mode', handoff.mode === 'add' ? 'add' : 'fresh');
            url.searchParams.set('variant', handoff.variant === 'freewallet' ? 'freewallet' : 'default');
            url.searchParams.set('lane', handoff.lane === 'backup' ? 'backup' : 'mnemonic');
        }
        await chromeApi.tabs.create({ url: url.href });
    } catch {
        return false;
    }
    if (isToolbarPopupView(view, chromeApi.extension)) {
        try { view.close?.(); } catch { /* The new tab remains the active handoff. */ }
    }
    return true;
}
