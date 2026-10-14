// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export const CONTENT_PROBE_TYPE = 'xchain.contentProbe';

export function isSidePanelView(view = globalThis.window) {
    return Boolean(view?.location?.pathname?.endsWith('/sidepanel.html'));
}

/**
 * Ask the active tab's existing content script whether the provider bridge is
 * available. A missing receiver is the expected result on browser pages,
 * store pages, file URLs, and built-in document viewers.
 *
 * @param {typeof chrome | undefined} chromeApi
 * @returns {Promise<boolean>}
 */
export function activeTabSupportsWallet(chromeApi = globalThis.chrome) {
    return new Promise((resolve) => {
        const tabsApi = chromeApi?.tabs;
        if (typeof tabsApi?.query !== 'function'
            || typeof tabsApi?.sendMessage !== 'function') {
            resolve(false);
            return;
        }

        try {
            tabsApi.query({ active: true, currentWindow: true }, (tabs) => {
                const queryError = chromeApi?.runtime?.lastError;
                const tabId = tabs?.[0]?.id;
                if (queryError || !Number.isInteger(tabId)) {
                    resolve(false);
                    return;
                }

                let timeoutId = null;
                try {
                    let settled = false;
                    const finish = (supported) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeoutId);
                        resolve(supported);
                    };
                    timeoutId = setTimeout(() => finish(false), 1500);
                    tabsApi.sendMessage(tabId, { type: CONTENT_PROBE_TYPE }, (response) => {
                        const sendError = chromeApi?.runtime?.lastError;
                        finish(!sendError && response?.available === true);
                    });
                } catch {
                    clearTimeout(timeoutId);
                    resolve(false);
                }
            });
        } catch {
            resolve(false);
        }
    });
}

/**
 * Refresh support when the active tab changes or its document navigates.
 *
 * @param {() => void} refresh
 * @param {typeof chrome | undefined} chromeApi
 * @returns {() => void}
 */
export function watchActiveTab(refresh, chromeApi = globalThis.chrome) {
    const activated = chromeApi?.tabs?.onActivated;
    const updated = chromeApi?.tabs?.onUpdated;
    try { activated?.addListener?.(refresh); } catch { /* The initial probe still settles. */ }
    try { updated?.addListener?.(refresh); } catch { /* The initial probe still settles. */ }
    return () => {
        try { activated?.removeListener?.(refresh); } catch { /* The view is already closing. */ }
        try { updated?.removeListener?.(refresh); } catch { /* The view is already closing. */ }
    };
}
