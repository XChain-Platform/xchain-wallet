// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createLaunchRouteState,
    isToolbarPopupView,
    openExtensionTab,
    parseExtensionHandoff,
    shellForExtensionView,
} from '../../../packages/extension/src/popup/launchState.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('extension popup launch state', () => {
    it('uses compact layout for the toolbar popup and full layout for a tab', () => {
        const popup = { location: { pathname: '/popup.html' }, innerWidth: 400 };
        const tab = { location: { pathname: '/popup.html' }, innerWidth: 1200 };
        const extensionApi = { getViews: () => [popup] };

        expect(shellForExtensionView(popup, extensionApi)).toBe('popup');
        expect(shellForExtensionView(tab, extensionApi)).toBe('web');
    });

    it('keeps the side panel compact and falls back to available width', () => {
        const sidePanel = { location: { pathname: '/sidepanel.html' }, innerWidth: 900 };
        expect(shellForExtensionView(sidePanel, { getViews: () => [] })).toBe('popup');
        expect(shellForExtensionView(
            { location: { pathname: '/popup.html' }, innerWidth: 601 },
            undefined,
        )).toBe('web');
    });

    it('distinguishes toolbar popups from side panels and tabs', () => {
        const popup = { location: { pathname: '/popup.html' }, innerWidth: 400 };
        const tab = { location: { pathname: '/popup.html' }, innerWidth: 400 };
        const sidePanel = { location: { pathname: '/sidepanel.html' }, innerWidth: 400 };
        const extensionApi = { getViews: vi.fn(() => [popup]) };

        expect(isToolbarPopupView(popup, extensionApi)).toBe(true);
        expect(isToolbarPopupView(tab, extensionApi)).toBe(false);
        expect(isToolbarPopupView(sidePanel, extensionApi)).toBe(false);
    });

    it('opens a tab with validated import state and closes the source popup', async () => {
        const close = vi.fn();
        const popup = {
            close,
            location: { pathname: '/popup.html' },
            innerWidth: 400,
        };
        const tabsCreate = vi.fn().mockResolvedValue({ id: 9 });
        vi.stubGlobal('window', popup);
        vi.stubGlobal('chrome', {
            extension: { getViews: vi.fn(() => [popup]) },
            runtime: { getURL: vi.fn(() => 'chrome-extension://wallet/popup.html') },
            tabs: { create: tabsCreate },
        });

        await expect(openExtensionTab({
            flow: 'import', mode: 'add', variant: 'freewallet', lane: 'backup',
            mnemonic: 'do not transfer', password: 'do not transfer',
        })).resolves.toBe(true);
        expect(tabsCreate).toHaveBeenCalledWith({
            url: 'chrome-extension://wallet/popup.html?handoff=import&mode=add&variant=freewallet&lane=backup',
        });
        expect(close).toHaveBeenCalledOnce();
    });

    it('keeps the popup open when tab creation fails', async () => {
        const close = vi.fn();
        const popup = {
            close,
            location: { pathname: '/popup.html' },
            innerWidth: 400,
        };
        vi.stubGlobal('window', popup);
        vi.stubGlobal('chrome', {
            extension: { getViews: vi.fn(() => [popup]) },
            runtime: { getURL: vi.fn(() => 'chrome-extension://wallet/popup.html') },
            tabs: { create: vi.fn().mockRejectedValue(new Error('tabs unavailable')) },
        });

        await expect(openExtensionTab({ flow: 'backup' })).resolves.toBe(false);
        expect(close).not.toHaveBeenCalled();
    });

    it('parses only supported handoff state and applies safe defaults', () => {
        expect(parseExtensionHandoff(
            '?handoff=import&mode=add&variant=freewallet&lane=backup',
        )).toEqual({
            flow: 'import', mode: 'add', variant: 'freewallet', lane: 'backup',
        });
        expect(parseExtensionHandoff('?handoff=hardware')).toEqual({ flow: 'hardware' });
        expect(parseExtensionHandoff('?handoff=unknown&mode=add')).toBeNull();
        expect(parseExtensionHandoff('?handoff=import&mode=bad&lane=bad')).toEqual({
            flow: 'import', mode: 'fresh', variant: 'default', lane: 'mnemonic',
        });
    });

    it('does not let last-view restoration replace a locked-launch deep link', () => {
        const launch = createLaunchRouteState();
        launch.remember('send');

        expect(launch.takeForSession({ state: 'locked' })).toBeNull();
        expect(launch.takeForSession({ state: 'unlocked' })).toBe('send');
        expect(launch.shouldSkipLastViewResume()).toBe(true);

        launch.walletActivated();
        expect(launch.shouldSkipLastViewResume()).toBe(false);
        expect(launch.takeForSession({ state: 'unlocked' })).toBeNull();
    });

    it('does not queue an intent that already applied to an unlocked shell', () => {
        const launch = createLaunchRouteState();
        launch.remember('receive', { state: 'unlocked' });

        expect(launch.shouldSkipLastViewResume()).toBe(false);
        expect(launch.takeForSession({ state: 'unlocked' })).toBeNull();
    });

    it('clears a queued route when a later intent is invalid', () => {
        const launch = createLaunchRouteState();
        launch.remember('send');
        launch.clear();

        expect(launch.shouldSkipLastViewResume()).toBe(false);
        expect(launch.takeForSession({ state: 'unlocked' })).toBeNull();
    });
});
