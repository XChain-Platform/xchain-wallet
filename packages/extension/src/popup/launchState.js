// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { createLaunchRouteState } from '@xchain-wallet/core/shared/utils/launchRouteState.js';
import { LAYOUT_MODE_STORAGE_KEY } from '@xchain-wallet/core/shared/utils/layoutModeStorageKey.js';
import {
    FULL_SCREEN_TAB_SESSION_KEY,
    POPUP_AFTER_TAB_SESSION_KEY,
    storageAreaWrite,
} from '../shared/walletViewState.js';

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
 * Select the shared route layout for an extension page. Only the toolbar
 * popup stays compact; the side panel and popup.html opened in a browser tab
 * use the full layout. Width is a fallback for browsers without getViews().
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
    if (view.location?.pathname?.endsWith('/sidepanel.html')) return FULL_LAYOUT_SHELL;

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

/**
 * Which view switches the wallet menu offers in this extension view: each
 * view offers the two it is not. The toolbar popup offers Sidebar and Full
 * screen, the side panel offers Popup and Full screen, and a full browser tab
 * offers Popup and Sidebar. Each is offered only when the browser has the API
 * it needs.
 *
 * @param {Window | undefined} [view]
 * @param {any} [chromeApi]
 * @returns {{ popup: boolean, sidebar: boolean, fullScreen: boolean }}
 */
export function walletViewSwitches(view = globalThis.window, chromeApi = globalThis.chrome) {
    const pathname = view?.location?.pathname || '';
    const sidePanel = pathname.endsWith('/sidepanel.html');
    const canPopup = typeof chromeApi?.action?.setPopup === 'function';
    const canSidebar = typeof chromeApi?.sidePanel?.open === 'function';
    const canTab = typeof chromeApi?.tabs?.create === 'function'
        && typeof chromeApi?.runtime?.getURL === 'function';
    if (sidePanel) return { popup: canPopup, sidebar: false, fullScreen: canTab };
    if (!pathname.endsWith('/popup.html')) return { popup: false, sidebar: false, fullScreen: false };
    if (isToolbarPopupView(view, chromeApi?.extension)) return { popup: false, sidebar: canSidebar, fullScreen: canTab };
    return { popup: canPopup, sidebar: canSidebar, fullScreen: false };
}

/**
 * Opens the wallet as the toolbar popup from the side panel or a full-screen
 * tab, and closes the view the user left. The popup mode goes out in the
 * click's own turn: the stored choice, a dropped full-screen record, and the
 * action's popup page set directly, so the icon opens the popup at once
 * whatever the worker is doing. The view's close then reads to the worker as
 * leaving for the popup, which the stored mode already says.
 *
 * From the side panel, `action.openPopup` (Chrome 127+) runs in the same
 * turn, inside the click, before the panel closes. A popup opened from a tab
 * closes when that tab goes, so a tab instead records itself for the worker,
 * which opens the popup once the tab is removed. Where openPopup is missing or
 * refused, the next toolbar click opens the popup.
 *
 * @param {{ chromeApi?: any, view?: Window }} [options]
 * @returns {Promise<boolean>} true when the popup opened, or is handed to the worker to open
 */
export async function openWalletPopup(options = {}) {
    const chromeApi = options.chromeApi || globalThis.chrome;
    const view = options.view || globalThis.window;
    if (typeof chromeApi?.action?.setPopup !== 'function') return false;
    const settled = (fn) => {
        try {
            return Promise.resolve(fn()).then(() => true, () => false);
        } catch {
            return Promise.resolve(false);
        }
    };
    const fromPanel = (view?.location?.pathname || '').endsWith('/sidepanel.html');
    const pageSet = settled(() => chromeApi.action.setPopup({ popup: 'popup.html' }));
    const recorded = Promise.all([
        storageAreaWrite(chromeApi?.storage?.session, 'remove', FULL_SCREEN_TAB_SESSION_KEY),
        storageAreaWrite(chromeApi?.storage?.local, 'set', { [LAYOUT_MODE_STORAGE_KEY]: 'popup' }),
    ]);
    const opening = fromPanel && typeof chromeApi.action.openPopup === 'function'
        ? settled(() => chromeApi.action.openPopup())
        : Promise.resolve(false);
    await pageSet;
    await recorded;
    if (fromPanel) {
        const opened = await opening;
        try { view.close?.(); } catch { /* The popup mode is set either way. */ }
        return opened;
    }
    try {
        const tab = await chromeApi.tabs?.getCurrent?.();
        if (!Number.isInteger(tab?.id)) return false;
        const handed = await storageAreaWrite(chromeApi?.storage?.session, 'set', {
            [POPUP_AFTER_TAB_SESSION_KEY]: { tabId: tab.id },
        });
        await chromeApi.tabs.remove(tab.id);
        return handed;
    } catch {
        // The tab stays open; the toolbar icon opens the popup.
        return false;
    }
}

/**
 * Opens the wallet in the browser's side panel for `windowId`, makes the
 * toolbar icon toggle the panel, and closes the view the user left: the popup
 * closes itself, a full-screen tab removes its own tab. Must run inside the
 * click: the browser opens a side panel only during a user gesture, so nothing
 * is awaited before `sidePanel.open`.
 *
 * The toolbar popup can close as soon as the panel takes focus, so it sends its
 * mode write in the same turn as `sidePanel.open` and puts Popup back if the
 * panel refuses (a view that offers Open in sidebar is always in popup or
 * full-screen mode, and both store Popup). A full-screen tab outlives the open,
 * so it records the mode after the panel opens and clears the full-screen
 * record before the tab goes, so the worker does not read that removal as the
 * user closing full screen.
 *
 * @param {{ windowId?: number | null, chromeApi?: any, view?: Window }} [options]
 * @returns {Promise<boolean>} true when the side panel opened
 */
export async function openWalletSidebar(options = {}) {
    const chromeApi = options.chromeApi || globalThis.chrome;
    const view = options.view || globalThis.window;
    const windowId = Number.isInteger(options.windowId)
        ? options.windowId
        : chromeApi?.windows?.WINDOW_ID_CURRENT;
    if (typeof chromeApi?.sidePanel?.open !== 'function' || !Number.isInteger(windowId)) return false;
    const fromPopup = isToolbarPopupView(view, chromeApi.extension);
    let opening;
    try {
        opening = Promise.resolve(chromeApi.sidePanel.open({ windowId }));
    } catch {
        return false;
    }
    const earlyRecord = fromPopup ? recordSidebarMode(chromeApi) : null;
    try {
        await opening;
    } catch {
        if (earlyRecord) {
            await earlyRecord;
            await storageAreaWrite(chromeApi?.storage?.local, 'set', { [LAYOUT_MODE_STORAGE_KEY]: 'popup' });
        }
        return false;
    }
    if (fromPopup) {
        await earlyRecord;
        try { view.close?.(); } catch { /* The side panel is open either way. */ }
        return true;
    }
    await recordSidebarMode(chromeApi);
    try {
        const tab = await chromeApi.tabs?.getCurrent?.();
        if (Number.isInteger(tab?.id)) await chromeApi.tabs.remove(tab.id);
    } catch {
        // The full-screen tab stays open beside the side panel.
    }
    return true;
}

/**
 * Opens the wallet full screen: popup.html in a new browser tab, which lays
 * the wallet out for the window's size, and makes the toolbar icon jump to
 * that tab. The tab opens in the background and comes forward only once it is
 * recorded: the toolbar popup closes when an active tab takes focus, which
 * would drop a record still being written. The popup or side panel the user
 * left then closes itself, so the worker reads a closing panel as the move to
 * full screen rather than the panel's X.
 *
 * @param {{ chromeApi?: any, view?: Window }} [options]
 * @returns {Promise<boolean>} true when the tab opened
 */
export async function openWalletFullScreen(options = {}) {
    const chromeApi = options.chromeApi || globalThis.chrome;
    const view = options.view || globalThis.window;
    if (typeof chromeApi?.tabs?.create !== 'function' || typeof chromeApi?.runtime?.getURL !== 'function') {
        return false;
    }
    let created;
    try {
        created = await chromeApi.tabs.create({ url: chromeApi.runtime.getURL('popup.html'), active: false });
    } catch {
        return false;
    }
    await recordFullScreenTab(chromeApi, created);
    if (Number.isInteger(created?.id)) {
        try {
            await chromeApi.tabs.update(created.id, { active: true });
        } catch {
            // The tab is open in the background; the toolbar icon still jumps to it.
        }
    }
    const pathname = view?.location?.pathname || '';
    if (pathname.endsWith('/sidepanel.html') || isToolbarPopupView(view, chromeApi.extension)) {
        try { view.close?.(); } catch { /* The new tab is open either way. */ }
    }
    return true;
}

/**
 * Side-panel mode: the stored choice becomes the sidebar and any full-screen
 * record is dropped. Both writes go out in the calling turn. Failures leave the
 * icon on its previous view.
 *
 * @param {any} chromeApi
 */
async function recordSidebarMode(chromeApi) {
    await Promise.all([
        storageAreaWrite(chromeApi?.storage?.session, 'remove', FULL_SCREEN_TAB_SESSION_KEY),
        storageAreaWrite(chromeApi?.storage?.local, 'set', { [LAYOUT_MODE_STORAGE_KEY]: 'sidepanel' }),
    ]);
}

/**
 * Full-screen mode: the session record names the new tab, written before the
 * stored choice returns to the popup, which is where the icon goes once the
 * tab closes or the browser restarts.
 *
 * @param {any} chromeApi
 * @param {{ id?: number, windowId?: number } | undefined} tab
 */
async function recordFullScreenTab(chromeApi, tab) {
    if (!Number.isInteger(tab?.id)) return;
    const record = { tabId: tab.id, windowId: Number.isInteger(tab.windowId) ? tab.windowId : null };
    const recorded = await storageAreaWrite(chromeApi?.storage?.session, 'set', { [FULL_SCREEN_TAB_SESSION_KEY]: record });
    if (recorded) await storageAreaWrite(chromeApi?.storage?.local, 'set', { [LAYOUT_MODE_STORAGE_KEY]: 'popup' });
}
