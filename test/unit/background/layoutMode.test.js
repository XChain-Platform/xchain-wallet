// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The toolbar icon follows the wallet view the user picked (operator
// 2026-11-22): the popup by default, a side panel the icon toggles, or a
// full-screen tab the icon jumps to. Closing the panel with its own X, or
// closing the full-screen tab, returns the icon to the popup.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createToolbarViewController,
    isSidePanelSupported,
    readLayoutMode,
    writeLayoutMode,
} from '../../../packages/extension/src/background/layoutMode.js';
import {
    openWalletFullScreen,
    openWalletPopup,
    openWalletSidebar,
} from '../../../packages/extension/src/popup/launchState.js';
import {
    FULL_SCREEN_TAB_SESSION_KEY,
    POPUP_AFTER_TAB_SESSION_KEY,
    SIDE_PANEL_CLOSE_MESSAGE,
    sidePanelPortName,
} from '../../../packages/extension/src/shared/walletViewState.js';

const STORAGE_KEY = 'xchain.layoutMode';
const EXT_ID = 'abc';

function event() {
    const fns = [];
    return {
        fns,
        addListener: vi.fn((fn) => { fns.push(fn); }),
        removeListener: vi.fn((fn) => {
            const i = fns.indexOf(fn);
            if (i >= 0) fns.splice(i, 1);
        }),
        fire: (...args) => fns.map((fn) => fn(...args)),
    };
}

/**
 * A chrome object the worker controller and the wallet pages share, so a
 * page's storage write reaches the worker's storage listener as in Chrome.
 * Opening a side panel connects its page's port; closing one disconnects it.
 * With `panelEvents`, Chrome's sidePanel.onOpened and onClosed fire too
 * (Chrome 142+); `reloadPanel` drops and reconnects a port with no event, the
 * way a page reload does.
 */
function fakeChrome({
    local = {}, session = {}, sidePanel = true, sidePanelClose = true, tabs = {}, panelEvents = false,
} = {}) {
    const onChanged = event();
    const area = (name, store) => ({
        store,
        get: vi.fn(async (key) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items) => {
            const changes = {};
            for (const [k, v] of Object.entries(items)) {
                if (JSON.stringify(store[k]) === JSON.stringify(v)) continue;
                changes[k] = { oldValue: store[k], newValue: v };
                store[k] = v;
            }
            if (Object.keys(changes).length) onChanged.fire(changes, name);
        }),
        remove: vi.fn(async (key) => {
            if (!(key in store)) return;
            const oldValue = store[key];
            delete store[key];
            onChanged.fire({ [key]: { oldValue } }, name);
        }),
    });
    const onConnect = event();
    const onRemoved = event();
    const onOpened = event();
    const onClosed = event();
    const openTabs = new Map(Object.entries(tabs).map(([id, t]) => [Number(id), { id: Number(id), ...t }]));
    /** @type {Map<number, any>} */
    const panelPorts = new Map();
    let nextTabId = 100;

    function connectPanel(windowId, origin = `chrome-extension://${EXT_ID}`, { reloaded = false } = {}) {
        const onDisconnect = event();
        const port = {
            name: sidePanelPortName(windowId, reloaded),
            sender: { origin },
            postMessage: vi.fn(),
            disconnect: vi.fn(),
            onDisconnect,
            onMessage: event(),
        };
        panelPorts.set(windowId, port);
        onConnect.fire(port);
        return port;
    }
    function openPanel(windowId) {
        if (panelPorts.has(windowId)) return;
        if (panelEvents) onOpened.fire({ windowId, path: '/sidepanel.html' });
        connectPanel(windowId);
    }
    function closePanel(windowId) {
        const port = panelPorts.get(windowId);
        if (!port) return;
        panelPorts.delete(windowId);
        if (panelEvents) onClosed.fire({ windowId, path: '/sidepanel.html' });
        port.onDisconnect.fire();
    }
    function reloadPanel(windowId) {
        const port = panelPorts.get(windowId);
        if (!port) return;
        panelPorts.delete(windowId);
        port.onDisconnect.fire();
        connectPanel(windowId, undefined, { reloaded: true });
    }

    const api = {
        runtime: {
            id: EXT_ID,
            onConnect,
            getURL: (p) => `chrome-extension://${EXT_ID}/${p}`,
            getContexts: vi.fn(async () => [...panelPorts.keys()].map((windowId) => ({ contextType: 'SIDE_PANEL', windowId }))),
        },
        action: {
            setPopup: vi.fn(async () => {}),
            openPopup: vi.fn(async () => {}),
            onClicked: event(),
        },
        storage: { local: area('local', { ...local }), session: area('session', { ...session }), onChanged },
        tabs: {
            get: vi.fn(async (id) => {
                if (!openTabs.has(id)) throw new Error(`No tab with id: ${id}`);
                return openTabs.get(id);
            }),
            update: vi.fn(async () => {}),
            create: vi.fn(async ({ url }) => {
                const tab = { id: nextTabId++, windowId: 1, url };
                openTabs.set(tab.id, tab);
                return tab;
            }),
            getCurrent: vi.fn(async () => undefined),
            remove: vi.fn(async (id) => {
                openTabs.delete(id);
                onRemoved.fire(id, { windowId: 1, isWindowClosing: false });
            }),
            onRemoved,
        },
        windows: { update: vi.fn(async () => {}), WINDOW_ID_CURRENT: -2 },
        extension: { getViews: () => [] },
    };
    if (sidePanel) {
        api.sidePanel = {
            setPanelBehavior: vi.fn(async () => {}),
            open: vi.fn(async ({ windowId }) => { openPanel(windowId); }),
        };
        if (panelEvents) Object.assign(api.sidePanel, { onOpened, onClosed });
        if (sidePanelClose) api.sidePanel.close = vi.fn(async ({ windowId }) => { closePanel(windowId); });
    }
    return { api, connectPanel, openPanel, closePanel, reloadPanel, panelPorts, openTabs };
}

const settle = async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};

async function boot(fake, { reloadGraceMs = 0 } = {}) {
    const controller = createToolbarViewController({ chromeApi: fake.api, logger: { warn: vi.fn() }, reloadGraceMs });
    controller.start();
    await controller.ready;
    await settle();
    return controller;
}

const lastCall = (fn) => fn.mock.calls[fn.mock.calls.length - 1]?.[0];
const clickIcon = (fake, windowId = 1) => fake.api.action.onClicked.fire({ id: 1, windowId });

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('layout mode storage', () => {
    it('defaults missing and invalid stored values to popup mode', async () => {
        expect(await readLayoutMode(undefined)).toBe('popup');
        expect(await readLayoutMode(fakeChrome({ local: { [STORAGE_KEY]: 'floating' } }).api)).toBe('popup');
    });

    it('reads and writes supported modes through chrome.storage.local', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' } });
        expect(await readLayoutMode(fake.api)).toBe('sidepanel');
        await writeLayoutMode('popup', fake.api);
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('popup');
        await expect(writeLayoutMode('floating', fake.api)).rejects.toThrow(/invalid mode floating/);
    });
});

describe('toolbar view controller', () => {
    it('starts in popup mode when no full-screen tab is recorded for this browser session', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'popup' } });
        const controller = await boot(fake);
        expect(controller.currentMode()).toBe('popup');
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: 'popup.html' });
        expect(lastCall(fake.api.sidePanel.setPanelBehavior)).toEqual({ openPanelOnActionClick: false });
    });

    it('opens the side panel on a click and closes it on the next, staying in side-panel mode', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' } });
        const controller = await boot(fake);
        // With no panel open Chrome opens it on the click itself, which needs
        // no loaded worker state.
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: '' });
        expect(lastCall(fake.api.sidePanel.setPanelBehavior)).toEqual({ openPanelOnActionClick: true });

        fake.connectPanel(1);
        await settle();
        // An open panel routes the next click to the worker, which closes it.
        expect(lastCall(fake.api.sidePanel.setPanelBehavior)).toEqual({ openPanelOnActionClick: false });

        clickIcon(fake, 1);
        await settle();
        expect(fake.api.sidePanel.close).toHaveBeenCalledWith({ windowId: 1 });
        expect(fake.panelPorts.has(1)).toBe(false);
        expect(controller.currentMode()).toBe('sidepanel');
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('sidepanel');
        expect(lastCall(fake.api.sidePanel.setPanelBehavior)).toEqual({ openPanelOnActionClick: true });
    });

    it('opens the panel from the worker when the click lands in another window', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' } });
        await boot(fake);
        fake.connectPanel(1);
        await settle();
        clickIcon(fake, 2);
        expect(fake.api.sidePanel.open).toHaveBeenCalledWith({ windowId: 2 });
    });

    it('asks the panel page to close itself where chrome.sidePanel.close is missing', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' }, sidePanelClose: false });
        const controller = await boot(fake);
        const port = fake.connectPanel(1);
        await settle();
        clickIcon(fake, 1);
        await settle();
        expect(port.postMessage).toHaveBeenCalledWith({ type: SIDE_PANEL_CLOSE_MESSAGE });
        // The page's window.close() drops the port: still the toggle.
        fake.closePanel(1);
        await settle();
        expect(controller.currentMode()).toBe('sidepanel');
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('sidepanel');
    });

    it("returns to the popup when the panel's own X closes it", async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' } });
        const controller = await boot(fake);
        fake.connectPanel(1);
        await settle();
        fake.closePanel(1);
        await settle();
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('popup');
        expect(controller.currentMode()).toBe('popup');
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: 'popup.html' });
    });

    it('without panel events, keeps side-panel mode when a reloaded panel reconnects inside the grace window', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' } });
        const controller = await boot(fake, { reloadGraceMs: 40 });
        fake.connectPanel(1);
        await settle();
        fake.reloadPanel(1);
        await new Promise((r) => setTimeout(r, 80));
        await settle();
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('sidepanel');
        expect(controller.currentMode()).toBe('sidepanel');

        // Without the reconnect the same close is the X.
        fake.closePanel(1);
        await new Promise((r) => setTimeout(r, 80));
        await settle();
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('popup');
    });

    it('without panel events, a panel the user opens again inside the grace window does not cancel the X', async () => {
        // Real Chromium 2026-11-22: an icon click right after the X reopened
        // the panel, whose fresh port read as a reload and kept the sidebar.
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' } });
        const controller = await boot(fake, { reloadGraceMs: 40 });
        fake.connectPanel(1);
        await settle();
        fake.closePanel(1);
        await settle();
        // The X reads as the X at once: the next click opens the popup.
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: 'popup.html' });
        fake.connectPanel(1);
        await new Promise((r) => setTimeout(r, 80));
        await settle();
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('popup');
        // A panel opened again (Chrome's own menu) still holds the icon until it closes.
        expect(controller.currentMode()).toBe('sidepanel');
        fake.closePanel(1);
        await new Promise((r) => setTimeout(r, 80));
        await settle();
        expect(controller.currentMode()).toBe('popup');
    });

    it("with panel events, the panel's X returns the icon to the popup at once, so the next click opens the popup", async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' }, panelEvents: true });
        // A long grace proves the event path does not wait on it.
        const controller = await boot(fake, { reloadGraceMs: 60_000 });
        fake.openPanel(1);
        await settle();
        expect(lastCall(fake.api.sidePanel.setPanelBehavior)).toEqual({ openPanelOnActionClick: false });

        fake.closePanel(1);
        await settle();
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('popup');
        expect(controller.currentMode()).toBe('popup');
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: 'popup.html' });
        expect(lastCall(fake.api.sidePanel.setPanelBehavior)).toEqual({ openPanelOnActionClick: false });
    });

    it('with panel events, the toolbar toggle closes the panel and keeps side-panel mode', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' }, panelEvents: true });
        const controller = await boot(fake, { reloadGraceMs: 60_000 });
        fake.openPanel(1);
        await settle();
        clickIcon(fake, 1);
        await settle();
        expect(fake.api.sidePanel.close).toHaveBeenCalledWith({ windowId: 1 });
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('sidepanel');
        expect(controller.currentMode()).toBe('sidepanel');
        expect(lastCall(fake.api.sidePanel.setPanelBehavior)).toEqual({ openPanelOnActionClick: true });
    });

    it('with panel events, a panel reload keeps side-panel mode', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' }, panelEvents: true });
        const controller = await boot(fake, { reloadGraceMs: 0 });
        fake.openPanel(1);
        await settle();
        fake.reloadPanel(1);
        await settle();
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('sidepanel');
        expect(controller.currentMode()).toBe('sidepanel');
        expect(lastCall(fake.api.sidePanel.setPanelBehavior)).toEqual({ openPanelOnActionClick: false });
    });

    it('with panel events, a restarted worker learns of a panel still open', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' }, panelEvents: true });
        await boot(fake);
        fake.openPanel(3);
        await settle();
        // A second controller stands in for the worker after Chrome stopped it.
        const restarted = await boot(fake);
        expect(fake.api.runtime.getContexts).toHaveBeenCalledWith({ contextTypes: ['SIDE_PANEL'] });
        expect(restarted.currentMode()).toBe('sidepanel');
        expect(lastCall(fake.api.sidePanel.setPanelBehavior)).toEqual({ openPanelOnActionClick: false });
    });

    it('keeps side-panel mode while another window still shows the panel', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' } });
        const controller = await boot(fake);
        fake.connectPanel(1);
        fake.connectPanel(2);
        await settle();
        fake.closePanel(1);
        await settle();
        expect(controller.currentMode()).toBe('sidepanel');
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('sidepanel');
    });

    it('never opens the popup over an open panel, even with Popup chosen', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'popup' } });
        const controller = await boot(fake);
        fake.connectPanel(1);
        await settle();
        expect(controller.currentMode()).toBe('sidepanel');
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: '' });
        clickIcon(fake, 1);
        await settle();
        expect(fake.api.sidePanel.close).toHaveBeenCalledWith({ windowId: 1 });
        expect(fake.api.action.openPopup).not.toHaveBeenCalled();
        expect(controller.currentMode()).toBe('popup');
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: 'popup.html' });
    });

    it('ignores a panel port from outside the extension', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'popup' } });
        const controller = await boot(fake);
        const port = fake.connectPanel(1, 'https://evil.example');
        await settle();
        expect(port.disconnect).toHaveBeenCalled();
        expect(controller.currentMode()).toBe('popup');
    });

    it('focuses the full-screen tab and its window on a click', async () => {
        const fake = fakeChrome({
            local: { [STORAGE_KEY]: 'popup' },
            session: { [FULL_SCREEN_TAB_SESSION_KEY]: { tabId: 5, windowId: 3 } },
            tabs: { 5: { windowId: 3 } },
        });
        const controller = await boot(fake);
        expect(controller.currentMode()).toBe('fullscreen');
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: '' });
        expect(lastCall(fake.api.sidePanel.setPanelBehavior)).toEqual({ openPanelOnActionClick: false });

        clickIcon(fake, 1);
        await settle();
        expect(fake.api.tabs.update).toHaveBeenCalledWith(5, { active: true });
        expect(fake.api.windows.update).toHaveBeenCalledWith(3, { focused: true });
        expect(fake.api.sidePanel.open).not.toHaveBeenCalled();
        expect(fake.api.action.openPopup).not.toHaveBeenCalled();
    });

    it('returns to the popup when the full-screen tab closes, and not for other tabs', async () => {
        const fake = fakeChrome({
            local: { [STORAGE_KEY]: 'popup' },
            session: { [FULL_SCREEN_TAB_SESSION_KEY]: { tabId: 5, windowId: 3 } },
            tabs: { 5: { windowId: 3 }, 6: { windowId: 3 } },
        });
        const controller = await boot(fake);
        await fake.api.tabs.remove(6);
        await settle();
        expect(controller.currentMode()).toBe('fullscreen');

        await fake.api.tabs.remove(5);
        await settle();
        expect(controller.currentMode()).toBe('popup');
        expect(fake.api.storage.session.store[FULL_SCREEN_TAB_SESSION_KEY]).toBeUndefined();
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: 'popup.html' });
    });

    it('opens the popup when the recorded full-screen tab is already gone', async () => {
        const fake = fakeChrome({
            local: { [STORAGE_KEY]: 'popup' },
            session: { [FULL_SCREEN_TAB_SESSION_KEY]: { tabId: 5, windowId: 3 } },
        });
        const controller = await boot(fake);
        const before = fake.api.action.setPopup.mock.calls.length;
        clickIcon(fake, 1);
        await settle();
        expect(controller.currentMode()).toBe('popup');
        expect(fake.api.action.openPopup).toHaveBeenCalledTimes(1);
        // The popup is set before it is opened, so openPopup has a page to show.
        expect(fake.api.action.setPopup.mock.calls[before][0]).toEqual({ popup: 'popup.html' });
        expect(fake.api.action.setPopup.mock.invocationCallOrder[before])
            .toBeLessThan(fake.api.action.openPopup.mock.invocationCallOrder[0]);
    });

    it('acts on a click that wakes a cold worker once its state is read', async () => {
        const fake = fakeChrome({
            local: { [STORAGE_KEY]: 'popup' },
            session: { [FULL_SCREEN_TAB_SESSION_KEY]: { tabId: 5, windowId: 3 } },
            tabs: { 5: { windowId: 3 } },
        });
        const controller = createToolbarViewController({ chromeApi: fake.api, logger: { warn: vi.fn() } });
        controller.start();
        clickIcon(fake, 1);
        await settle();
        expect(fake.api.tabs.update).toHaveBeenCalledWith(5, { active: true });
    });

    it('moving from the full-screen tab to the side panel keeps side-panel mode when the tab closes', async () => {
        const fake = fakeChrome({
            local: { [STORAGE_KEY]: 'popup' },
            session: { [FULL_SCREEN_TAB_SESSION_KEY]: { tabId: 5, windowId: 1 } },
            tabs: { 5: { windowId: 1 } },
        });
        const controller = await boot(fake);
        fake.api.tabs.getCurrent.mockResolvedValue({ id: 5, windowId: 1 });
        const tabView = { location: { pathname: '/popup.html' }, innerWidth: 1280, close: vi.fn() };

        await expect(openWalletSidebar({ windowId: 1, chromeApi: fake.api, view: tabView })).resolves.toBe(true);
        await settle();

        expect(fake.api.tabs.remove).toHaveBeenCalledWith(5);
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('sidepanel');
        expect(fake.api.storage.session.store[FULL_SCREEN_TAB_SESSION_KEY]).toBeUndefined();
        expect(controller.currentMode()).toBe('sidepanel');
        // The next click hides the panel rather than opening the popup.
        clickIcon(fake, 1);
        await settle();
        expect(fake.api.sidePanel.close).toHaveBeenCalledWith({ windowId: 1 });
        expect(controller.currentMode()).toBe('sidepanel');
    });

    it('moving from the side panel to full screen keeps full-screen mode when the panel closes', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' } });
        const controller = await boot(fake);
        fake.connectPanel(1);
        await settle();
        const panelView = {
            location: { pathname: '/sidepanel.html' },
            innerWidth: 400,
            close: vi.fn(() => fake.closePanel(1)),
        };

        await expect(openWalletFullScreen({ chromeApi: fake.api, view: panelView })).resolves.toBe(true);
        await settle();

        expect(panelView.close).toHaveBeenCalledTimes(1);
        expect(fake.api.storage.session.store[FULL_SCREEN_TAB_SESSION_KEY]).toEqual({ tabId: 100, windowId: 1 });
        expect(controller.currentMode()).toBe('fullscreen');
        clickIcon(fake, 1);
        await settle();
        expect(fake.api.tabs.update).toHaveBeenCalledWith(100, { active: true });
    });

    it('Open as popup from the side panel sets popup mode, opens the popup, and the panel close keeps it', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' }, panelEvents: true });
        const controller = await boot(fake);
        fake.openPanel(1);
        await settle();
        const panelView = {
            location: { pathname: '/sidepanel.html' },
            close: vi.fn(() => fake.closePanel(1)),
        };

        const pending = openWalletPopup({ chromeApi: fake.api, view: panelView });
        // Both go out in the click's turn: the popup page, then openPopup.
        expect(fake.api.action.setPopup).toHaveBeenLastCalledWith({ popup: 'popup.html' });
        expect(fake.api.action.openPopup).toHaveBeenCalledTimes(1);
        await expect(pending).resolves.toBe(true);
        await settle();

        expect(panelView.close).toHaveBeenCalledTimes(1);
        expect(fake.api.storage.local.store[STORAGE_KEY]).toBe('popup');
        expect(controller.currentMode()).toBe('popup');
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: 'popup.html' });
    });

    it('Open as popup from the full-screen tab removes the tab and the worker opens the popup', async () => {
        const fake = fakeChrome({
            local: { [STORAGE_KEY]: 'popup' },
            session: { [FULL_SCREEN_TAB_SESSION_KEY]: { tabId: 5, windowId: 1 } },
            tabs: { 5: { windowId: 1 } },
            panelEvents: true,
        });
        const controller = await boot(fake);
        fake.api.tabs.getCurrent.mockResolvedValue({ id: 5, windowId: 1 });
        const tabView = { location: { pathname: '/popup.html' }, innerWidth: 1280, close: vi.fn() };

        await expect(openWalletPopup({ chromeApi: fake.api, view: tabView })).resolves.toBe(true);
        await settle();

        expect(fake.api.tabs.remove).toHaveBeenCalledWith(5);
        // A popup opened from the tab closes with it, so the worker opens it after.
        expect(fake.api.action.openPopup).toHaveBeenCalledTimes(1);
        expect(fake.api.action.openPopup.mock.invocationCallOrder[0])
            .toBeGreaterThan(fake.api.tabs.remove.mock.invocationCallOrder[0]);
        expect(fake.api.storage.session.store[FULL_SCREEN_TAB_SESSION_KEY]).toBeUndefined();
        expect(fake.api.storage.session.store[POPUP_AFTER_TAB_SESSION_KEY]).toBeUndefined();
        expect(controller.currentMode()).toBe('popup');
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: 'popup.html' });
    });

    it('moving from the popup to full screen makes the icon jump to the new tab', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'popup' } });
        const controller = await boot(fake);
        const popupView = { location: { pathname: '/popup.html' }, innerWidth: 360, close: vi.fn() };
        fake.api.extension.getViews = () => [popupView];

        await openWalletFullScreen({ chromeApi: fake.api, view: popupView });
        await settle();
        expect(popupView.close).toHaveBeenCalledTimes(1);
        expect(controller.currentMode()).toBe('fullscreen');
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: '' });
    });

    it('runs the open-wallet command the way a click does', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'popup' } });
        const controller = await boot(fake);
        await controller.activate({ windowId: 1 });
        expect(fake.api.action.openPopup).toHaveBeenCalledTimes(1);

        await fake.api.storage.local.set({ [STORAGE_KEY]: 'sidepanel' });
        await settle();
        controller.activate({ windowId: 1 });
        expect(fake.api.sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });
    });

    it('keeps popup behavior when the side-panel API is absent', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'sidepanel' }, sidePanel: false });
        expect(isSidePanelSupported(fake.api)).toBe(false);
        const controller = await boot(fake);
        expect(controller.currentMode()).toBe('popup');
        expect(lastCall(fake.api.action.setPopup)).toEqual({ popup: 'popup.html' });
    });

    it('follows a Settings change and detaches its listeners', async () => {
        const fake = fakeChrome({ local: { [STORAGE_KEY]: 'popup' } });
        const controller = createToolbarViewController({ chromeApi: fake.api, logger: { warn: vi.fn() } });
        const detach = controller.start();
        await controller.ready;
        await fake.api.storage.local.set({ [STORAGE_KEY]: 'sidepanel' });
        await settle();
        expect(controller.currentMode()).toBe('sidepanel');

        detach();
        expect(fake.api.storage.onChanged.fns).toHaveLength(0);
        expect(fake.api.action.onClicked.fns).toHaveLength(0);
        expect(fake.api.runtime.onConnect.fns).toHaveLength(0);
        expect(fake.api.tabs.onRemoved.fns).toHaveLength(0);
    });

    it('stays inert where chrome is missing', async () => {
        const controller = createToolbarViewController({ chromeApi: undefined, logger: { warn: vi.fn() } });
        expect(() => controller.start()).not.toThrow();
        await controller.ready;
        expect(controller.currentMode()).toBe('popup');
    });
});
