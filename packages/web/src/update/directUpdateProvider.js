// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one place the update feed is wired to anything (§6, D4).
//
// `directUpdateCheck.js` is the hardened client; `installOrigin.js` is the
// lane question; core's `flows/directUpdate.js` is the seam the UI reads. This
// module is the single edge that joins them, and it joins them only when the
// native shell says this install has no store behind it.
//
// Keeping the join in one small file is deliberate. The rule "the update feed
// must not be reachable from a store build" is otherwise the kind of rule that
// is true when it is written and quietly false a month later, because it lives
// in a comment rather than in the shape of the code. Here there is exactly one
// caller of the feed client in the repo, and it is guarded on the line above.

import { setDirectUpdateProvider } from '@xchain-wallet/core/flows';
import { WALLET_VERSION } from '@xchain-wallet/core/buildInfo.js';
import {
    checkForDirectUpdate,
    isUpdateCheckEnabled,
    setUpdateCheckEnabled,
    UPDATE_FEED_URL,
} from './directUpdateCheck.js';
import { getInstallOrigin, isSelfUpdatingLane } from './installOrigin.js';

/**
 * Install the provider when, and only when, this build is a direct install.
 *
 * Safe to call more than once: `getSessionStatus()` runs it on every refresh
 * (that is what keeps the biometric enrollment flag honest), and a second
 * install of an equivalent provider is a no-op in effect.
 *
 * @param {{ currentVersion?: string }} [opts]
 * @returns {Promise<boolean>} whether this install owns its own updates
 */
export async function installDirectUpdateProvider(opts = {}) {
    const origin = await getInstallOrigin();
    if (!isSelfUpdatingLane(origin)) {
        // Uninstall rather than leave a stale provider behind. This matters in
        // one real case: a test or a dev reload that installed a provider and
        // then switched shells would otherwise keep a lane the app no longer
        // has, and the About panel would offer a setting that does nothing.
        setDirectUpdateProvider(null);
        return false;
    }
    const currentVersion = opts.currentVersion ?? WALLET_VERSION;
    setDirectUpdateProvider({
        check: (checkOpts = {}) => checkForDirectUpdate({
            currentVersion,
            force: Boolean(checkOpts.force),
        }),
        isEnabled: () => isUpdateCheckEnabled(),
        setEnabled: (enabled) => setUpdateCheckEnabled(enabled),
        feedUrl: UPDATE_FEED_URL,
    });
    return true;
}
