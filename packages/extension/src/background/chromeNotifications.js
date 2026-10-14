// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

/**
 * Build the extension's OS notification adapter.
 * A false result tells notification producers to retain retryable state when
 * Chrome cannot display the notification.
 *
 * @param {typeof globalThis.chrome | undefined} chromeApi
 * @param {{ now?: () => number, logger?: Pick<Console, 'error'> }} [deps]
 */
export function createChromeNotifier(chromeApi = globalThis.chrome, deps = {}) {
    const now = deps.now ?? Date.now;
    const logger = deps.logger ?? console;
    let sequence = 0;

    return async ({ kind, title, body }) => {
        if (!chromeApi?.notifications?.create || !chromeApi?.runtime?.getURL) return false;

        try {
            await chromeApi.notifications.create(
                `xchain-${kind}-${now()}-${sequence++}`,
                {
                    type: 'basic',
                    iconUrl: chromeApi.runtime.getURL('icons/icon-128.png'),
                    title,
                    message: body,
                },
            );
            return true;
        } catch (err) {
            logger.error('[xchain] chrome.notifications failed:', err);
            return false;
        }
    };
}
