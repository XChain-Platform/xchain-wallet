// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Fiat rates for the desktop renderer. The price lookup
// (core flows/priceLookup.js) fetches from the page, which this renderer's
// CSP forbids (connect-src 'self'), so every Home balance and Send preview
// read "not priced". Its requests go to main as prices.fiatFetch instead,
// and main fetches only the lookup's own URLs (isFiatRateSourceUrl).

import { flows } from '@xchain-wallet/core';
import { sendMessage } from './bridgeMessaging.js';

/** Point the price lookup's fetch at main. Call once at boot. */
export function installDesktopFiatRateSource() {
    flows.configureFiatRateSource({
        fetch: async (url) => {
            const reply = /** @type {any} */ (await sendMessage('prices.fiatFetch', { url: String(url) }));
            return {
                ok: Boolean(reply?.ok),
                status: Number(reply?.status) || 0,
                json: async () => reply?.body,
            };
        },
    });
}
