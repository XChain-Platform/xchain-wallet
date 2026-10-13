// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
    createLaunchRouteState,
    shellForExtensionView,
} from '../../../packages/extension/src/popup/launchState.js';

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
});
