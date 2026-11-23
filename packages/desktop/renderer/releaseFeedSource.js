// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The release feed for Settings > About on desktop. The panel's own fetch is
// refused by this renderer's CSP (connect-src 'self'), so the feed text comes
// from main as updates.releaseFeed instead; main fetches only that one
// address, and the panel still validates what it gets.

import { flows } from '@xchain-wallet/core';
import { sendMessage } from './bridgeMessaging.js';

/** Point the About panel's feed read at main. Call once at boot. */
export function installDesktopReleaseFeedSource() {
    flows.configureReleaseFeedSource({
        fetchText: async () => {
            const reply = /** @type {any} */ (await sendMessage('updates.releaseFeed'));
            if (!reply?.ok || typeof reply.text !== 'string') throw new Error('update feed unavailable');
            return reply.text;
        },
    });
}
