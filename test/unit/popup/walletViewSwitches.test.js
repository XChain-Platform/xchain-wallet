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
    openWalletSidebar,
    walletViewSwitches,
} from '../../../packages/extension/src/popup/launchState.js';

const popup = { location: { pathname: '/popup.html' }, innerWidth: 380, close: vi.fn() };
const tab = { location: { pathname: '/popup.html' }, innerWidth: 1280, close: vi.fn() };
const sidePanel = { location: { pathname: '/sidepanel.html' }, innerWidth: 400, close: vi.fn() };

function chromeApi(overrides = {}) {
    return {
        extension: { getViews: () => [popup] },
        sidePanel: { open: vi.fn(() => Promise.resolve()) },
        tabs: {
            create: vi.fn(() => Promise.resolve({ id: 7 })),
            getCurrent: vi.fn(() => Promise.resolve({ id: 9 })),
            remove: vi.fn(() => Promise.resolve()),
        },
        runtime: { getURL: (path) => `chrome-extension://abc/${path}` },
        windows: { WINDOW_ID_CURRENT: -2 },
        ...overrides,
    };
}

describe('wallet view switches', () => {
    it('offers each view the switches that lead somewhere else', () => {
        const api = chromeApi();
        expect(walletViewSwitches(popup, api)).toEqual({ sidebar: true, fullScreen: true });
        expect(walletViewSwitches(sidePanel, api)).toEqual({ sidebar: false, fullScreen: true });
        expect(walletViewSwitches(tab, api)).toEqual({ sidebar: true, fullScreen: false });
    });

    it('offers nothing outside the extension pages or without the browser API', () => {
        expect(walletViewSwitches({ location: { pathname: '/approval.html' } }, chromeApi()))
            .toEqual({ sidebar: false, fullScreen: false });
        expect(walletViewSwitches(popup, chromeApi({ sidePanel: undefined, tabs: undefined })))
            .toEqual({ sidebar: false, fullScreen: false });
        expect(walletViewSwitches(popup, undefined)).toEqual({ sidebar: false, fullScreen: false });
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
        expect(api.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://abc/popup.html' });
        expect(popup.close).toHaveBeenCalledTimes(1);
        await expect(openWalletFullScreen({ chromeApi: api, view: sidePanel })).resolves.toBe(true);
        expect(sidePanel.close).toHaveBeenCalledTimes(1);
    });
});
