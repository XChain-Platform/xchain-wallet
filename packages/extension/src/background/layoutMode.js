// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Toolbar-icon controller for the wallet's three views. Only one view shows
// at a time, and the icon follows the one the user picked:
//
//   `popup`      - the icon opens popup.html as the toolbar popup (default).
//   `sidepanel`  - the icon shows the side panel, and hides it when it is
//                  already open in that window. Closing the panel with
//                  Chrome's own X returns the icon to the popup.
//   `fullscreen` - the icon activates the full-screen wallet tab and focuses
//                  its window. Closing that tab returns the icon to the popup.
//
// State:
//   - chrome.storage.local `xchain.layoutMode` holds 'popup' or 'sidepanel',
//     the value the Settings "Open as" tile shows and writes.
//   - chrome.storage.session holds the full-screen tab record
//     (shared/walletViewState.js). Session storage ends with the browser
//     session, and entering full screen writes 'popup' to the local key, so a
//     worker that starts without a session record is in popup mode.
//   - Which windows show the panel comes from chrome.sidePanel.onOpened and
//     onClosed (Chrome 142+), seeded from runtime.getContexts when the worker
//     starts. A close this controller asked for (the toolbar toggle) is
//     remembered per window; any other close is the user's X, or the panel
//     leaving for another view, and returns the icon to the popup at once.
//     The events do not fire for a page reload, and they wake the worker.
//   - Each open side panel also holds a port named for its window. Browsers
//     without the events learn of a close only from that port: a drop that is
//     not the toggle counts as the X at once, and a page that reconnects
//     inside a short grace window marked as a reload puts the sidebar back.
//     A panel the user opens again is not a reload, so a quick click after
//     the X never keeps the sidebar.
//
// Action mechanics, recomputed on every state change:
//   - popup                  → setPopup('popup.html'), openPanelOnActionClick false
//   - sidepanel, none open   → setPopup(''), openPanelOnActionClick true. Chrome
//                              opens the panel itself, which also works on a
//                              cold worker: sidePanel.open needs the click's
//                              gesture, and the boot read cannot finish first.
//   - sidepanel, a panel open→ setPopup(''), openPanelOnActionClick false. The
//                              click reaches action.onClicked, which closes the
//                              panel in that window or opens one in another.
//   - fullscreen             → setPopup(''), openPanelOnActionClick false.
//                              onClicked focuses the tab; no gesture needed.
// An open panel counts as side-panel mode whatever the stored choice, so the
// popup never opens over it (a panel opened from Chrome's own side-panel menu,
// or the Settings tile set to Popup from inside the panel).
//
// The side-panel API exists in Chrome 114+ (sidePanel.open in 116+,
// sidePanel.close in 141+, where older builds close from the page; onOpened
// in 141+ and onClosed in 142+, where older builds use the port). Without
// `chrome.sidePanel` the panel modes are never applied and the icon keeps
// opening the popup; full-screen mode needs only chrome.tabs.

import { isTrustedExtensionSender } from '../bridge/publicSurface.js';
import {
    FULL_SCREEN_TAB_SESSION_KEY,
    POPUP_AFTER_TAB_SESSION_KEY,
    SIDE_PANEL_CLOSE_MESSAGE,
    parseFullScreenTab,
    sidePanelPortIsReload,
    sidePanelPortWindowId,
    storageAreaGet,
    storageAreaWrite,
} from '../shared/walletViewState.js';

const STORAGE_KEY = 'xchain.layoutMode';
const POPUP_PATH = 'popup.html';
const TOGGLE_CLOSE_WINDOW_MS = 5000;
// Without chrome.sidePanel.onClosed, a panel that reloads (network switch, lock
// screen, Settings) drops its port and reconnects from boot.js marked as a
// reload; inside this window that reconnect puts the sidebar back.
const PANEL_RELOAD_GRACE_MS = 2000;

export const LAYOUT_MODES = /** @type {const} */ (['popup', 'sidepanel']);

/**
 * Whether the browser has the side-panel API. With no argument it reads the
 * worker's own chrome global.
 *
 * @param {any} [chromeApi]
 */
export function isSidePanelSupported(chromeApi) {
    return chromeApi === undefined ? !!globalThis.chrome?.sidePanel : !!chromeApi?.sidePanel;
}

export async function readLayoutMode(chromeApi = globalThis.chrome) {
    const items = await storageAreaGet(chromeApi?.storage?.local, STORAGE_KEY);
    const v = items?.[STORAGE_KEY];
    return LAYOUT_MODES.includes(v) ? v : 'popup';
}

export async function writeLayoutMode(mode, chromeApi = globalThis.chrome) {
    if (!LAYOUT_MODES.includes(mode)) {
        throw new Error(`writeLayoutMode: invalid mode ${mode}`);
    }
    await storageAreaWrite(chromeApi?.storage?.local, 'set', { [STORAGE_KEY]: mode });
}

async function readFullScreenTab(chromeApi) {
    const items = await storageAreaGet(chromeApi?.storage?.session, FULL_SCREEN_TAB_SESSION_KEY);
    return parseFullScreenTab(items?.[FULL_SCREEN_TAB_SESSION_KEY]);
}

/**
 * Build the toolbar-icon controller. `start()` registers every listener at
 * once, so it must run synchronously at worker boot: an event that wakes the
 * worker is delivered only to listeners registered in the worker's opening turn.
 *
 * @param {{ chromeApi?: any, logger?: { warn: Function }, reloadGraceMs?: number }} [deps]
 */
export function createToolbarViewController({
    chromeApi = globalThis.chrome,
    logger = console,
    reloadGraceMs = PANEL_RELOAD_GRACE_MS,
} = {}) {
    let savedMode = /** @type {'popup' | 'sidepanel'} */ ('popup');
    let fullScreen = /** @type {{ tabId: number, windowId: number | null } | null} */ (null);
    let appliedMode = /** @type {'popup' | 'sidepanel' | 'fullscreen'} */ ('popup');
    let loaded = false;
    /** @type {Map<number, any>} window id → side-panel port */
    const panels = new Map();
    /** Windows Chrome reports showing the panel (onOpened / onClosed). */
    const openedWindows = new Set();
    const panelEvents = typeof chromeApi?.sidePanel?.onOpened?.addListener === 'function'
        && typeof chromeApi?.sidePanel?.onClosed?.addListener === 'function';
    const panelOpenIn = (windowId) => openedWindows.has(windowId) || panels.has(windowId);
    const anyPanelOpen = () => openedWindows.size > 0 || panels.size > 0;
    /** Windows whose panel this controller is closing, so that close is not read as the X. */
    const closingByToggle = new Set();
    /** @type {Map<number, number>} window id → when its port drop returned the icon to the popup */
    const revertedAt = new Map();
    // Boot, storage changes, port events and tab removals all reconfigure the
    // action; one chain keeps their reads and writes from interleaving.
    let chain = Promise.resolve();
    const serial = (fn) => {
        const next = chain.then(fn);
        chain = next.catch(() => {});
        return next;
    };

    const sidePanelOk = () => !!chromeApi?.sidePanel;

    function effectiveMode() {
        if (fullScreen) return 'fullscreen';
        if (sidePanelOk() && (savedMode === 'sidepanel' || anyPanelOpen())) return 'sidepanel';
        return 'popup';
    }

    async function applyNow() {
        const mode = effectiveMode();
        appliedMode = mode;
        if (!chromeApi?.action?.setPopup) return;
        try {
            await chromeApi.action.setPopup({ popup: mode === 'popup' ? POPUP_PATH : '' });
            if (chromeApi.sidePanel?.setPanelBehavior) {
                await chromeApi.sidePanel.setPanelBehavior({
                    openPanelOnActionClick: mode === 'sidepanel' && !anyPanelOpen(),
                });
            }
        } catch (e) {
            // A bad configuration must not take down the worker; the popup
            // flow stays the safe default.
            logger.warn('[xchain-wallet/extension] toolbar view apply failed:', e);
        }
    }

    const apply = () => serial(applyNow);

    const refresh = () => serial(async () => {
        const [mode, record] = await Promise.all([readLayoutMode(chromeApi), readFullScreenTab(chromeApi)]);
        savedMode = mode;
        fullScreen = record;
        loaded = true;
        await applyNow();
    });

    // A restarted worker missed the onOpened of a panel that is still showing.
    async function seedOpenPanels() {
        if (!panelEvents || typeof chromeApi?.runtime?.getContexts !== 'function') return;
        try {
            const contexts = await chromeApi.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
            for (const c of contexts || []) {
                if (Number.isInteger(c?.windowId) && c.windowId >= 0) openedWindows.add(c.windowId);
            }
        } catch {
            // The ports still report the panel once it reconnects.
        }
    }

    const ready = serial(seedOpenPanels).then(refresh);

    async function openPopup() {
        try {
            await chromeApi.action.openPopup?.();
        } catch (e) {
            // Older Chrome, or no focused window: the next click opens it.
            logger.warn('[xchain-wallet/extension] openPopup failed:', e);
        }
    }

    function openPanel(windowId) {
        // Called with nothing awaited first: the panel opens only inside the
        // click or command gesture.
        try {
            return Promise.resolve(chromeApi.sidePanel.open({ windowId })).catch((e) => {
                logger.warn('[xchain-wallet/extension] sidePanel.open failed:', e);
            });
        } catch (e) {
            logger.warn('[xchain-wallet/extension] sidePanel.open failed:', e);
            return Promise.resolve();
        }
    }

    function closePanel(windowId) {
        const port = panels.get(windowId);
        closingByToggle.add(windowId);
        // A panel that never closes must not leave its later X read as the toggle.
        setTimeout(() => { if (panelOpenIn(windowId)) closingByToggle.delete(windowId); }, TOGGLE_CLOSE_WINDOW_MS);
        const askPage = () => {
            try {
                port.postMessage({ type: SIDE_PANEL_CLOSE_MESSAGE });
            } catch {
                closingByToggle.delete(windowId);
            }
        };
        // sidePanel.close is Chrome 141+; older builds close from the page.
        if (typeof chromeApi.sidePanel?.close !== 'function') {
            askPage();
            return Promise.resolve();
        }
        return Promise.resolve()
            .then(() => chromeApi.sidePanel.close({ windowId }))
            .catch(askPage);
    }

    const focusFullScreen = () => serial(async () => {
        const record = fullScreen;
        if (record) {
            try {
                const tab = await chromeApi.tabs.get(record.tabId);
                await chromeApi.tabs.update(record.tabId, { active: true });
                const windowId = Number.isInteger(tab?.windowId) ? tab.windowId : record.windowId;
                if (Number.isInteger(windowId)) await chromeApi.windows?.update?.(windowId, { focused: true });
                return;
            } catch {
                // The tab is gone; fall back to the popup below.
            }
        }
        fullScreen = null;
        await storageAreaWrite(chromeApi?.storage?.session, 'remove', FULL_SCREEN_TAB_SESSION_KEY);
        await applyNow();
        await openPopup();
    });

    function act(windowId) {
        if (appliedMode === 'fullscreen') return focusFullScreen();
        if (appliedMode === 'sidepanel') {
            if (panelOpenIn(windowId)) return closePanel(windowId);
            if (Number.isInteger(windowId)) return openPanel(windowId);
            return Promise.resolve();
        }
        return openPopup();
    }

    /**
     * The toolbar click and the open-wallet command. A loaded controller acts
     * at once, so a side panel opens inside the gesture. A cold worker waits
     * for its state first; the action click only lands here with a panel open
     * or in full-screen mode, and neither needs the gesture.
     *
     * @param {{ windowId?: number } | undefined} tab
     */
    function activate(tab) {
        const windowId = Number.isInteger(tab?.windowId)
            ? tab.windowId
            : chromeApi?.windows?.WINDOW_ID_CURRENT;
        if (loaded) return act(windowId);
        return ready.then(() => act(windowId));
    }

    function onPanelOpened(info) {
        const windowId = info?.windowId;
        if (!Number.isInteger(windowId)) return undefined;
        openedWindows.add(windowId);
        return apply();
    }

    function onPanelClosed(info) {
        const windowId = info?.windowId;
        if (!Number.isInteger(windowId)) return undefined;
        openedWindows.delete(windowId);
        // The closed page's port can drop after this event; it is gone either way.
        panels.delete(windowId);
        if (closingByToggle.delete(windowId)) return apply();
        return revertAfterPanelX();
    }

    function onPanelGone(windowId, port) {
        if (panels.get(windowId) === port) panels.delete(windowId);
        // With the panel events, onClosed reports the close; a lone port drop
        // is a reload or a worker restart.
        if (panelEvents) return apply();
        if (closingByToggle.delete(windowId) || panels.size > 0) return apply();
        // Not the toggle: read as the user's X at once, so the next click opens
        // the popup. A page that was only reloading reconnects marked as a
        // reload and restores the sidebar (onConnect).
        return revertAfterPanelX(windowId);
    }

    function revertAfterPanelX(windowId) {
        // Back to the popup, unless the panel closed itself on the way to full
        // screen (the session record is written first) or another panel is open.
        return serial(async () => {
            const [mode, record] = await Promise.all([readLayoutMode(chromeApi), readFullScreenTab(chromeApi)]);
            fullScreen = record;
            savedMode = mode;
            if (!record && mode === 'sidepanel' && !anyPanelOpen()) {
                savedMode = 'popup';
                await writeLayoutMode('popup', chromeApi);
                if (Number.isInteger(windowId)) revertedAt.set(windowId, Date.now());
            }
            await applyNow();
        });
    }

    // Without the panel events: a reloaded panel whose port drop just
    // returned the icon to the popup puts the sidebar back.
    function restoreAfterReload(windowId) {
        const at = revertedAt.get(windowId);
        revertedAt.delete(windowId);
        if (at === undefined || Date.now() - at > reloadGraceMs) return undefined;
        return serial(async () => {
            const [mode, record] = await Promise.all([readLayoutMode(chromeApi), readFullScreenTab(chromeApi)]);
            fullScreen = record;
            savedMode = mode;
            if (!record && mode === 'popup') {
                savedMode = 'sidepanel';
                await writeLayoutMode('sidepanel', chromeApi);
            }
            await applyNow();
        });
    }

    function onConnect(port) {
        const windowId = sidePanelPortWindowId(port?.name);
        if (windowId === null) return;
        if (!isTrustedExtensionSender(port.sender, chromeApi?.runtime?.id)) {
            try { port.disconnect?.(); } catch { /* already closed */ }
            return;
        }
        panels.set(windowId, port);
        if (!panelEvents && sidePanelPortIsReload(port.name)) restoreAfterReload(windowId);
        port.onDisconnect?.addListener?.(() => {
            // Read so Chrome does not log the closed port as unchecked.
            void chromeApi?.runtime?.lastError;
            onPanelGone(windowId, port);
        });
        apply();
    }

    function onTabRemoved(tabId) {
        // Read fresh: moving from the full-screen tab to the side panel clears
        // the record before it removes the tab, so that removal keeps the panel.
        return serial(async () => {
            const [mode, record, handoff] = await Promise.all([
                readLayoutMode(chromeApi),
                readFullScreenTab(chromeApi),
                storageAreaGet(chromeApi?.storage?.session, POPUP_AFTER_TAB_SESSION_KEY),
            ]);
            savedMode = mode;
            if (record?.tabId === tabId) {
                await storageAreaWrite(chromeApi?.storage?.session, 'remove', FULL_SCREEN_TAB_SESSION_KEY);
                fullScreen = null;
            } else {
                fullScreen = record;
            }
            await applyNow();
            // A tab that closed for Open as popup: its own openPopup would
            // have closed with it, so the popup opens now.
            if (handoff?.[POPUP_AFTER_TAB_SESSION_KEY]?.tabId === tabId) {
                await storageAreaWrite(chromeApi?.storage?.session, 'remove', POPUP_AFTER_TAB_SESSION_KEY);
                if (appliedMode === 'popup') await openPopup();
            }
        });
    }

    function onStorageChanged(changes, areaName) {
        if (areaName === 'local' && Object.prototype.hasOwnProperty.call(changes || {}, STORAGE_KEY)) refresh();
        if (areaName === 'session' && Object.prototype.hasOwnProperty.call(changes || {}, FULL_SCREEN_TAB_SESSION_KEY)) refresh();
    }

    const onClicked = (tab) => { activate(tab); };

    function start() {
        const detach = [];
        const listen = (event, fn) => {
            if (typeof event?.addListener !== 'function') return;
            event.addListener(fn);
            detach.push(() => event.removeListener?.(fn));
        };
        listen(chromeApi?.action?.onClicked, onClicked);
        listen(chromeApi?.sidePanel?.onOpened, onPanelOpened);
        listen(chromeApi?.sidePanel?.onClosed, onPanelClosed);
        listen(chromeApi?.runtime?.onConnect, onConnect);
        listen(chromeApi?.tabs?.onRemoved, onTabRemoved);
        listen(chromeApi?.storage?.onChanged, onStorageChanged);
        return () => { for (const fn of detach) fn(); };
    }

    return {
        start,
        activate,
        ready,
        currentMode: () => appliedMode,
    };
}
