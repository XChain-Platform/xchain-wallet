// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ChromeSessionBackend — §11.2 secondary (session-only) storage for
// the extension target. Backed by `chrome.storage.session` (Chrome
// 102+), which is wiped when the browser closes. Useful for:
//
//   - An unlocked-session handle the popup can rehydrate across
//     open/close cycles without re-unlocking
//   - Short-lived dApp authentication tokens
//   - Any ephemeral state that should not survive a browser restart
//
// NOT for the wallet's encrypted seed blob — that's the primary
// ChromeStorageBackend. Mixing them up is a reliability bug class
// (user closes browser, loses wallet), so we keep them separate
// classes rather than a "mode" parameter.
//
// The extension manifest must include the "storage" permission for
// `chrome.storage.session` to work.

import { ChromeStorageBackend } from './ChromeStorageBackend.js';

export const DEFAULT_SESSION_STORAGE_KEY = 'xchain-wallet:session';

export class ChromeSessionBackend extends ChromeStorageBackend {
    /** @param {import('./ChromeStorageBackend.js').ChromeStorageBackendOpts} [opts] */
    constructor(opts = {}) {
        const resolved =
            opts.chromeStorage ??
            /** @type {import('./ChromeStorageBackend.js').ChromeStorageLike | undefined} */ (
                globalThis.chrome?.storage?.session
            );
        if (!resolved) {
            throw new Error(
                'ChromeSessionBackend: chrome.storage.session is not available (requires Chrome 102+ and the "storage" manifest permission); pass { chromeStorage } for non-extension contexts',
            );
        }
        super({
            key: opts.key ?? DEFAULT_SESSION_STORAGE_KEY,
            chromeStorage: resolved,
        });
    }
}
