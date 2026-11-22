// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The wallet menu's view switches (operator 2026-11-21): the toolbar popup
// offers Open in sidebar and Open full screen, the side panel offers Open
// full screen, and a full-screen tab offers Open in sidebar.

import { describe, expect, it, vi } from 'vitest';
import {
    openWalletFullScreen,
    openWalletPopup,
    openWalletSidebar,
    walletViewSwitches,
} from '../../../packages/extension/src/popup/launchState.js';
import { holdSidePanelPresence } from '../../../packages/extension/src/popup/sidePanelPresence.js';
import {
    FULL_SCREEN_TAB_SESSION_KEY,
    POPUP_AFTER_TAB_SESSION_KEY,
    SIDE_PANEL_CLOSE_MESSAGE,
    sidePanelPortIsReload,
    sidePanelPortWindowId,
} from '../../../packages/extension/src/shared/walletViewState.js';

const popup = { location: { pathname: '/popup.html' }, innerWidth: 380, close: vi.fn() };
const tab = { location: { pathname: '/popup.html' }, innerWidth: 1280, close: vi.fn() };
const sidePanel = { location: { pathname: '/sidepanel.html' }, innerWidth: 400, close: vi.fn() };

function chromeApi(overrides = {}) {
    return {
        extension: { getViews: () => [popup] },
        action: { setPopup: vi.fn(() => Promise.resolve()), openPopup: vi.fn(() => Promise.resolve()) },
        sidePanel: { open: vi.fn(() => Promise.resolve()) },
        tabs: {
            create: vi.fn(() => Promise.resolve({ id: 7 })),
            getCurrent: vi.fn(() => Promise.resolve({ id: 9 })),
            remove: vi.fn(() => Promise.resolve()),
            update: vi.fn(() => Promise.resolve()),
        },
        runtime: { getURL: (path) => `chrome-extension://abc/${path}` },
        windows: { WINDOW_ID_CURRENT: -2 },
        ...overrides,
    };
}

describe('wallet view switches', () => {
    it('offers each view the two views it is not', () => {
        const api = chromeApi();
        expect(walletViewSwitches(popup, api)).toEqual({ popup: false, sidebar: true, fullScreen: true });
        expect(walletViewSwitches(sidePanel, api)).toEqual({ popup: true, sidebar: false, fullScreen: true });
        expect(walletViewSwitches(tab, api)).toEqual({ popup: true, sidebar: true, fullScreen: false });
    });

    it('offers nothing outside the extension pages or without the browser API', () => {
        expect(walletViewSwitches({ location: { pathname: '/approval.html' } }, chromeApi()))
            .toEqual({ popup: false, sidebar: false, fullScreen: false });
        expect(walletViewSwitches(popup, chromeApi({ sidePanel: undefined, tabs: undefined })))
            .toEqual({ popup: false, sidebar: false, fullScreen: false });
        expect(walletViewSwitches(sidePanel, chromeApi({ action: undefined, tabs: undefined })))
            .toEqual({ popup: false, sidebar: false, fullScreen: false });
        expect(walletViewSwitches(popup, undefined)).toEqual({ popup: false, sidebar: false, fullScreen: false });
    });

    it('Open as popup sets the popup page and opens the popup in the click, then closes the side panel', async () => {
        const order = [];
        const api = chromeApi({
            action: {
                setPopup: vi.fn(async (o) => { order.push(['setPopup', o.popup]); }),
                openPopup: vi.fn(async () => { order.push(['openPopup']); }),
            },
            storage: {
                local: { set: vi.fn(async (items) => { order.push(['local', items]); }) },
                session: { remove: vi.fn(async (key) => { order.push(['session-remove', key]); }) },
            },
        });
        const panel = { location: { pathname: '/sidepanel.html' }, close: vi.fn(() => { order.push(['close']); }) };
        const pending = openWalletPopup({ chromeApi: api, view: panel });
        // Issued before any await, inside the user's click.
        expect(api.action.setPopup).toHaveBeenCalledWith({ popup: 'popup.html' });
        expect(api.action.openPopup).toHaveBeenCalledTimes(1);
        await expect(pending).resolves.toBe(true);
        expect(order.at(-1)).toEqual(['close']);
        expect(order).toContainEqual(['local', { 'xchain.layoutMode': 'popup' }]);
        expect(order).toContainEqual(['session-remove', FULL_SCREEN_TAB_SESSION_KEY]);
    });

    it('Open as popup from a tab hands the popup to the worker and removes the tab', async () => {
        const order = [];
        const api = chromeApi({
            storage: {
                local: { set: vi.fn(async () => {}) },
                session: {
                    set: vi.fn(async (items) => { order.push(['session-set', items]); }),
                    remove: vi.fn(async () => {}),
                },
            },
        });
        api.tabs.remove = vi.fn(async (id) => { order.push(['remove', id]); });
        await expect(openWalletPopup({ chromeApi: api, view: tab })).resolves.toBe(true);
        // A popup opened from the tab would close with it.
        expect(api.action.openPopup).not.toHaveBeenCalled();
        expect(order).toEqual([
            ['session-set', { [POPUP_AFTER_TAB_SESSION_KEY]: { tabId: 9 } }],
            ['remove', 9],
        ]);
    });

    it('Open as popup still switches the mode where openPopup is refused', async () => {
        const local = { set: vi.fn(async () => {}) };
        const api = chromeApi({
            action: { setPopup: vi.fn(async () => {}), openPopup: vi.fn(() => Promise.reject(new Error('no window'))) },
            storage: { local, session: { remove: vi.fn(async () => {}) } },
        });
        const panel = { location: { pathname: '/sidepanel.html' }, close: vi.fn() };
        await expect(openWalletPopup({ chromeApi: api, view: panel })).resolves.toBe(false);
        expect(local.set).toHaveBeenCalledWith({ 'xchain.layoutMode': 'popup' }, expect.any(Function));
        expect(panel.close).toHaveBeenCalledTimes(1);
    });

    it('opens the side panel in the click and closes the popup', async () => {
        const api = chromeApi();
        popup.close.mockClear();
        const pending = openWalletSidebar({ windowId: 4, chromeApi: api, view: popup });
        // Called before any await, so the user gesture still holds.
        expect(api.sidePanel.open).toHaveBeenCalledWith({ windowId: 4 });
        await expect(pending).resolves.toBe(true);
        expect(popup.close).toHaveBeenCalledTimes(1);
        expect(api.tabs.remove).not.toHaveBeenCalled();
    });

    it('falls back to the current window and removes a full-screen tab after opening the panel', async () => {
        const api = chromeApi();
        await expect(openWalletSidebar({ chromeApi: api, view: tab })).resolves.toBe(true);
        expect(api.sidePanel.open).toHaveBeenCalledWith({ windowId: -2 });
        expect(api.tabs.remove).toHaveBeenCalledWith(9);
    });

    it('keeps the view open when the side panel refuses to open', async () => {
        const api = chromeApi({ sidePanel: { open: vi.fn(() => Promise.reject(new Error('no gesture'))) } });
        popup.close.mockClear();
        await expect(openWalletSidebar({ windowId: 4, chromeApi: api, view: popup })).resolves.toBe(false);
        expect(popup.close).not.toHaveBeenCalled();
    });

    it('opens popup.html full screen in a tab and closes the popup or side panel', async () => {
        const api = chromeApi();
        popup.close.mockClear();
        sidePanel.close.mockClear();
        await expect(openWalletFullScreen({ chromeApi: api, view: popup })).resolves.toBe(true);
        expect(api.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://abc/popup.html', active: false });
        expect(api.tabs.update).toHaveBeenCalledWith(7, { active: true });
        expect(popup.close).toHaveBeenCalledTimes(1);
        await expect(openWalletFullScreen({ chromeApi: api, view: sidePanel })).resolves.toBe(true);
        expect(sidePanel.close).toHaveBeenCalledTimes(1);
    });

    it('records full-screen mode before the popup closes', async () => {
        const writes = [];
        const api = chromeApi({
            storage: {
                local: { set: vi.fn(async (items) => { writes.push(['local', items]); }) },
                session: { set: vi.fn(async (items) => { writes.push(['session', items]); }) },
            },
        });
        api.tabs.create = vi.fn(async (props) => { writes.push(['create', props.active]); return { id: 7, windowId: 3 }; });
        api.tabs.update = vi.fn(async (id, props) => { writes.push(['update', id, props]); });
        popup.close.mockClear();
        popup.close.mockImplementationOnce(() => { writes.push(['close']); });
        await expect(openWalletFullScreen({ chromeApi: api, view: popup })).resolves.toBe(true);
        // The tab comes forward only after the record: a focused tab closes the popup.
        expect(writes).toEqual([
            ['create', false],
            ['session', { [FULL_SCREEN_TAB_SESSION_KEY]: { tabId: 7, windowId: 3 } }],
            ['local', { 'xchain.layoutMode': 'popup' }],
            ['update', 7, { active: true }],
            ['close'],
        ]);
    });

    it('sends the popup\'s side-panel mode write in the same turn as opening the panel', () => {
        const local = { set: vi.fn(async () => {}) };
        const api = chromeApi({ storage: { local, session: { remove: vi.fn(async () => {}) } } });
        // Never resolves: the popup may be gone before the panel reports back.
        api.sidePanel.open = vi.fn(() => new Promise(() => {}));
        void openWalletSidebar({ windowId: 4, chromeApi: api, view: popup });
        expect(api.sidePanel.open).toHaveBeenCalledWith({ windowId: 4 });
        expect(local.set).toHaveBeenCalledWith({ 'xchain.layoutMode': 'sidepanel' }, expect.any(Function));
    });

    it('puts Popup back when the panel refuses to open from the popup', async () => {
        const local = { set: vi.fn(async () => {}) };
        const api = chromeApi({ storage: { local, session: { remove: vi.fn(async () => {}) } } });
        api.sidePanel.open = vi.fn(() => Promise.reject(new Error('no gesture')));
        await expect(openWalletSidebar({ windowId: 4, chromeApi: api, view: popup })).resolves.toBe(false);
        expect(local.set.mock.calls.map((c) => c[0])).toEqual([
            { 'xchain.layoutMode': 'sidepanel' },
            { 'xchain.layoutMode': 'popup' },
        ]);
    });

    it('records side-panel mode and drops the full-screen record before removing the tab', async () => {
        const order = [];
        const api = chromeApi({
            storage: {
                local: { set: vi.fn(async (items) => { order.push(['local', items]); }) },
                session: { remove: vi.fn(async (key) => { order.push(['session-remove', key]); }) },
            },
        });
        api.tabs.remove = vi.fn(async (id) => { order.push(['remove', id]); });
        await expect(openWalletSidebar({ windowId: 4, chromeApi: api, view: tab })).resolves.toBe(true);
        expect(order).toEqual([
            ['session-remove', FULL_SCREEN_TAB_SESSION_KEY],
            ['local', { 'xchain.layoutMode': 'sidepanel' }],
            ['remove', 9],
        ]);
    });
});

describe('side-panel presence port', () => {
    function portApi() {
        const ports = [];
        const connect = vi.fn(({ name }) => {
            const disconnectFns = [];
            const messageFns = [];
            const port = {
                name,
                disconnect: vi.fn(),
                onDisconnect: { addListener: (fn) => disconnectFns.push(fn) },
                onMessage: { addListener: (fn) => messageFns.push(fn) },
                drop: () => disconnectFns.forEach((fn) => fn()),
                deliver: (m) => messageFns.forEach((fn) => fn(m)),
            };
            ports.push(port);
            return port;
        });
        return {
            ports,
            api: {
                runtime: { connect },
                windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 12 })) },
            },
        };
    }
    const flush = () => new Promise((r) => setTimeout(r, 5));

    it('holds a port named for its window and closes the panel when the worker asks', async () => {
        const { api, ports } = portApi();
        const view = { location: { pathname: '/sidepanel.html' }, close: vi.fn() };
        const stop = holdSidePanelPresence({ chromeApi: api, view });
        await flush();
        expect(ports.map((p) => p.name)).toEqual(['xchain-sidepanel/12']);
        ports[0].deliver({ type: 'other' });
        expect(view.close).not.toHaveBeenCalled();
        ports[0].deliver({ type: SIDE_PANEL_CLOSE_MESSAGE });
        expect(view.close).toHaveBeenCalledTimes(1);
        stop();
        expect(ports[0].disconnect).toHaveBeenCalled();
    });

    it('reconnects after the worker restarts, and stops when told to', async () => {
        const { api, ports } = portApi();
        const view = { location: { pathname: '/sidepanel.html' }, close: vi.fn() };
        const stop = holdSidePanelPresence({ chromeApi: api, view, reconnectMs: 1 });
        await flush();
        ports[0].drop();
        await flush();
        expect(ports).toHaveLength(2);
        expect(ports[1].name).toBe('xchain-sidepanel/12');
        stop();
        ports[1].drop();
        await flush();
        expect(ports).toHaveLength(2);
    });

    it('stays inert in the popup and in a tab', async () => {
        const { api, ports } = portApi();
        holdSidePanelPresence({ chromeApi: api, view: popup });
        holdSidePanelPresence({ chromeApi: api, view: tab });
        await flush();
        expect(ports).toHaveLength(0);
    });

    it('marks the port of a panel page that loaded by reloading', async () => {
        const { api, ports } = portApi();
        const view = {
            location: { pathname: '/sidepanel.html' },
            close: vi.fn(),
            performance: { getEntriesByType: () => [{ type: 'reload' }] },
        };
        holdSidePanelPresence({ chromeApi: api, view });
        await flush();
        expect(ports.map((p) => p.name)).toEqual(['xchain-sidepanel/12/reload']);
        expect(sidePanelPortWindowId(ports[0].name)).toBe(12);
        expect(sidePanelPortIsReload(ports[0].name)).toBe(true);
        expect(sidePanelPortIsReload('xchain-sidepanel/12')).toBe(false);
        expect(sidePanelPortWindowId('approval-watch')).toBeNull();
    });
});
