// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Names the wallet pages and the service worker share to keep the toolbar
// icon on the view the user picked (background/layoutMode.js).

/**
 * chrome.storage.session key holding `{ tabId, windowId }` of the full-screen
 * wallet tab. Session storage ends with the browser session, so full-screen
 * mode never outlives the tab's browser run.
 */
export const FULL_SCREEN_TAB_SESSION_KEY = 'xchain.fullScreenTab';

/**
 * chrome.storage.session key holding `{ tabId }` of a wallet tab that is
 * closing to make way for the toolbar popup. A popup opened from a tab closes
 * when that tab goes, so the worker opens it once the tab is removed.
 */
export const POPUP_AFTER_TAB_SESSION_KEY = 'xchain.popupAfterTab';

/**
 * Port name prefix the side panel holds open, followed by its window id and,
 * for a page that loaded by reloading, a reload marker.
 */
export const SIDE_PANEL_PORT_PREFIX = 'xchain-sidepanel/';
const RELOAD_SUFFIX = '/reload';

/** Worker-to-panel message asking the side panel to close itself. */
export const SIDE_PANEL_CLOSE_MESSAGE = 'xchain-sidepanel/close';

/**
 * @param {number} windowId
 * @param {boolean} [reloaded] the page loaded by reloading the panel
 * @returns {string}
 */
export function sidePanelPortName(windowId, reloaded = false) {
    return `${SIDE_PANEL_PORT_PREFIX}${windowId}${reloaded ? RELOAD_SUFFIX : ''}`;
}

/**
 * The window id a side-panel port names, or null for any other port.
 *
 * @param {unknown} name
 * @returns {number | null}
 */
export function sidePanelPortWindowId(name) {
    if (typeof name !== 'string' || !name.startsWith(SIDE_PANEL_PORT_PREFIX)) return null;
    const rest = name.slice(SIDE_PANEL_PORT_PREFIX.length);
    const id = Number(rest.endsWith(RELOAD_SUFFIX) ? rest.slice(0, -RELOAD_SUFFIX.length) : rest);
    return Number.isInteger(id) ? id : null;
}

/**
 * Whether a side-panel port comes from a page that loaded by reloading the
 * panel, as opposed to a panel the user opened again.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function sidePanelPortIsReload(name) {
    return sidePanelPortWindowId(name) !== null && String(name).endsWith(RELOAD_SUFFIX);
}

/**
 * A stored full-screen record, or null when it is missing or malformed.
 *
 * @param {unknown} value
 * @returns {{ tabId: number, windowId: number | null } | null}
 */
export function parseFullScreenTab(value) {
    const tabId = /** @type {any} */ (value)?.tabId;
    if (!Number.isInteger(tabId)) return null;
    const windowId = /** @type {any} */ (value).windowId;
    return { tabId, windowId: Number.isInteger(windowId) ? windowId : null };
}

/**
 * Read one key from a chrome.storage area, accepting both the callback and
 * the promise forms. Resolves `{}` when the area is missing or the read fails,
 * so a view switch never waits on a broken store.
 *
 * @param {any} area
 * @param {string} key
 * @returns {Promise<Record<string, unknown>>}
 */
export function storageAreaGet(area, key) {
    return new Promise((resolve) => {
        if (typeof area?.get !== 'function') { resolve({}); return; }
        try {
            const pending = area.get(key, (items) => resolve(items || {}));
            if (typeof pending?.then === 'function') pending.then((items) => resolve(items || {}), () => resolve({}));
        } catch {
            resolve({});
        }
    });
}

/**
 * Run a chrome.storage write (`set` or `remove`), accepting both the callback
 * and the promise forms. Resolves false when the area is missing or the write
 * fails.
 *
 * @param {any} area
 * @param {'set' | 'remove'} verb
 * @param {unknown} arg
 * @returns {Promise<boolean>}
 */
export function storageAreaWrite(area, verb, arg) {
    return new Promise((resolve) => {
        if (typeof area?.[verb] !== 'function') { resolve(false); return; }
        try {
            const pending = area[verb](arg, () => resolve(true));
            if (typeof pending?.then === 'function') pending.then(() => resolve(true), () => resolve(false));
        } catch {
            resolve(false);
        }
    });
}
