// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The dev-mock SDK (web hostBridge, extension background sdkFactory) has no
// signer. Its signing stubs throw with this code so the wallet answers a
// signing attempt with a plain sentence saying nothing was signed, instead of
// reducing the stub's technical text to the generic failure line. The thrown
// message stays the stub's own text: it is the marker the release gate looks
// for in built bundles.

/** Code on every signing refusal the dev-mock SDK raises. */
export const DEV_MOCK_SIGNING_UNAVAILABLE = 'DEV_MOCK_SIGNING_UNAVAILABLE';

/**
 * The refusal a dev-mock signing stub throws.
 *
 * @param {string} message  the stub's technical text
 * @returns {Error & { code: string }}
 */
export function devMockSigningError(message) {
    const err = /** @type {Error & { code: string }} */ (new Error(message));
    err.code = DEV_MOCK_SIGNING_UNAVAILABLE;
    return err;
}
