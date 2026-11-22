// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The side panel's half of the toolbar toggle (background/layoutMode.js). Its
// own small module so boot.js can load it ahead of the wallet bundle: on a
// browser without chrome.sidePanel.onClosed, a panel that reloads (network
// switch, lock screen, Settings) reconnects within the worker's grace window
// and says it reloaded, instead of reading as the user's X.

import { SIDE_PANEL_CLOSE_MESSAGE, sidePanelPortName } from '../shared/walletViewState.js';

/**
 * Hold a port named for this window while the side panel is open, so the
 * worker knows the panel is showing and learns when it closes. The worker asks
 * the panel to close over the port where chrome.sidePanel.close is missing. A
 * worker that stops drops the port; the panel reconnects so the restarted
 * worker knows it again.
 *
 * @param {{ chromeApi?: any, view?: Window, reconnectMs?: number }} [options]
 * @returns {() => void} stops holding the port
 */
export function holdSidePanelPresence(options = {}) {
    const chromeApi = options.chromeApi || globalThis.chrome;
    const view = options.view || globalThis.window;
    const reconnectMs = options.reconnectMs ?? 250;
    if (!view?.location?.pathname?.endsWith('/sidepanel.html')
        || typeof chromeApi?.runtime?.connect !== 'function'
        || typeof chromeApi?.windows?.getCurrent !== 'function') {
        return () => {};
    }
    let stopped = false;
    let port = null;
    let timer = null;
    // Browsers without chrome.sidePanel.onClosed learn of a close only from
    // this port, so a reloaded page says so and is not taken for a reopen.
    let reloaded = false;
    try {
        reloaded = view.performance?.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
    } catch { /* Treated as a fresh open. */ }
    const open = (windowId) => {
        if (stopped) return;
        try {
            port = chromeApi.runtime.connect({ name: sidePanelPortName(windowId, reloaded) });
        } catch {
            // The extension reloaded under this page; nothing to reconnect to.
            port = null;
            return;
        }
        port?.onMessage?.addListener?.((message) => {
            if (message?.type !== SIDE_PANEL_CLOSE_MESSAGE) return;
            try { view.close?.(); } catch { /* The worker's next click retries. */ }
        });
        port?.onDisconnect?.addListener?.(() => {
            // Read so Chrome does not log the closed port as unchecked.
            void chromeApi.runtime.lastError;
            port = null;
            if (!stopped) timer = setTimeout(() => open(windowId), reconnectMs);
        });
    };
    Promise.resolve()
        .then(() => chromeApi.windows.getCurrent())
        .then((win) => { if (Number.isInteger(win?.id)) open(win.id); })
        .catch(() => { /* Without a window id the icon keeps Chrome's own panel toggle. */ });
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        try { port?.disconnect?.(); } catch { /* already closed */ }
    };
}
