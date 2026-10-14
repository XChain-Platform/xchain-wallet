// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    isToolbarPopupView,
    openExtensionTab,
    shellForExtensionView,
} from '../../../packages/extension/src/popup/launchState.js';

describe('extension popup launch edge cases', () => {
    it('rejects missing views and falls back when popup enumeration throws', () => {
        const narrowPopup = { location: { pathname: '/popup.html' }, innerWidth: 600 };
        const widePopup = { location: { pathname: '/popup.html' }, innerWidth: 601 };
        const throwingApi = { getViews: vi.fn(() => { throw new Error('view access denied'); }) };

        expect(isToolbarPopupView(null, throwingApi)).toBe(false);
        expect(isToolbarPopupView(narrowPopup, throwingApi)).toBe(true);
        expect(shellForExtensionView(narrowPopup, throwingApi)).toBe('popup');
        expect(shellForExtensionView(widePopup, throwingApi)).toBe('web');
        expect(shellForExtensionView(null, throwingApi)).toBe('popup');
    });

    it('falls back when reading the view-enumeration API itself is refused', () => {
        const extensionApi = {};
        Object.defineProperty(extensionApi, 'getViews', {
            get() { throw new Error('extension permission refused'); },
        });
        const popup = { location: { pathname: '/popup.html' }, innerWidth: 400 };

        expect(isToolbarPopupView(popup, extensionApi)).toBe(true);
        expect(shellForExtensionView(popup, extensionApi)).toBe('popup');
    });

    it.each([
        [null, {}],
        [{ flow: 'unknown' }, {
            runtime: { getURL: vi.fn() },
            tabs: { create: vi.fn() },
        }],
        [{ flow: 'backup' }, { runtime: {}, tabs: { create: vi.fn() } }],
        [{ flow: 'backup' }, { runtime: { getURL: vi.fn() }, tabs: {} }],
    ])('refuses an invalid handoff or unavailable tab API', async (handoff, chromeApi) => {
        await expect(openExtensionTab(handoff, { chromeApi, view: {} })).resolves.toBe(false);
    });

    it('keeps a successful handoff when closing the source popup is refused', async () => {
        const popup = {
            location: { pathname: '/popup.html' },
            innerWidth: 400,
            close: vi.fn(() => { throw new Error('close refused'); }),
        };
        const chromeApi = {
            extension: { getViews: vi.fn(() => [popup]) },
            runtime: { getURL: vi.fn(() => 'chrome-extension://wallet/popup.html') },
            tabs: { create: vi.fn().mockResolvedValue({ id: 3 }) },
        };

        await expect(openExtensionTab({ flow: 'hardware' }, { chromeApi, view: popup }))
            .resolves.toBe(true);
        expect(popup.close).toHaveBeenCalledOnce();
    });

    it('reports malformed extension URLs as a failed handoff', async () => {
        const chromeApi = {
            runtime: { getURL: vi.fn(() => 'not a url') },
            tabs: { create: vi.fn() },
        };

        await expect(openExtensionTab({ flow: 'backup' }, { chromeApi, view: {} }))
            .resolves.toBe(false);
        expect(chromeApi.tabs.create).not.toHaveBeenCalled();
    });
});
