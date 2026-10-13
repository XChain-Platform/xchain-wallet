// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { WALLET_VERSION } from '@xchain-wallet/core/buildInfo.js';

export const DESKTOP_PRODUCT_NAME = 'XChain Wallet';
export const DESKTOP_WINDOW_TITLE = DESKTOP_PRODUCT_NAME;

/** Native About-panel metadata uses the same version as Settings > About. */
export const DESKTOP_ABOUT_PANEL_OPTIONS = Object.freeze({
    applicationName: DESKTOP_PRODUCT_NAME,
    applicationVersion: WALLET_VERSION,
    version: WALLET_VERSION,
    copyright: 'Copyright © Dankest, LLC',
});

/**
 * Build the self-update menu command for direct-download installs.
 * Store-managed builds omit this item because their store owns update checks.
 *
 * @param {() => void} onCheckForUpdates
 * @returns {Electron.MenuItemConstructorOptions}
 */
export function createUpdateCheckMenuItem(onCheckForUpdates) {
    return {
        label: 'Check for Updates...',
        click: onCheckForUpdates,
    };
}

