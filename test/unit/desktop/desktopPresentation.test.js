// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { WALLET_VERSION } from '../../../packages/core/src/buildInfo.js';
import {
    DESKTOP_ABOUT_PANEL_OPTIONS,
    DESKTOP_PRODUCT_NAME,
    DESKTOP_WINDOW_TITLE,
    createUpdateCheckMenuItem,
} from '../../../packages/desktop/main/desktopPresentation.js';

describe('desktop presentation metadata', () => {
    it('keeps the native About panel and window title on the wallet identity', () => {
        expect(DESKTOP_PRODUCT_NAME).toBe('XChain Wallet');
        expect(DESKTOP_WINDOW_TITLE).toBe(DESKTOP_PRODUCT_NAME);
        expect(DESKTOP_ABOUT_PANEL_OPTIONS).toMatchObject({
            applicationName: DESKTOP_PRODUCT_NAME,
            applicationVersion: WALLET_VERSION,
            version: WALLET_VERSION,
        });
    });

    it('builds a user-triggered update check command', () => {
        const check = vi.fn();
        const item = createUpdateCheckMenuItem(check);

        expect(item.label).toBe('Check for updates…');
        item.click();
        expect(check).toHaveBeenCalledTimes(1);
    });
});
