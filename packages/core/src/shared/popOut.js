// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// "Open in new window" for the wallet menu. Only the web app and the
// extension popup can open the wallet somewhere bigger; the desktop app has
// its own windows and the mobile app has none, so neither offers the row.

import { isNativeShell } from './nativeShell.js';

/** True when this shell can open the wallet in a new window or tab. */
export function supportsPopOut() {
    if (typeof window === 'undefined' || isNativeShell() || globalThis.xchainWalletWindow) return false;
    const protocol = window.location?.protocol;
    return protocol === 'http:'
        || protocol === 'https:'
        || (protocol === 'chrome-extension:' && Number(window.innerWidth) <= 600);
}

/**
 * The shell's own way to open the wallet in a new window: a browser tab for
 * the extension popup (which then closes), a new window for the web app.
 * Null where the shell has none.
 *
 * @returns {(() => void | Promise<void>) | null}
 */
export function automaticPopOut() {
    if (!supportsPopOut()) return null;
    const protocol = window.location?.protocol;
    if (protocol === 'chrome-extension:') {
        const createTab = globalThis.chrome?.tabs?.create;
        if (typeof createTab !== 'function') return null;
        return async () => {
            try {
                await createTab({ url: window.location.href });
                window.close?.();
            } catch {
                // The popup stays open when the browser rejects tab creation.
            }
        };
    }
    return () => window.open(window.location.href, '_blank', 'noopener,noreferrer');
}
