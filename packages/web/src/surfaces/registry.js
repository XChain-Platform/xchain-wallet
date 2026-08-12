// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which SURFACES a build profile carries (; §2.3, §7).
//
// The `store` profile is the mobile app-store build. §2.3 requires the
// screens app-store review posture hides to be COMPILED OUT of it, not hidden
// at runtime: a store-hidden surface that some switch can turn back on is an
// App Review guideline 2.3.1 hidden-feature violation, and the penalty there is
// developer-account termination, which takes every Apple surface with it (iOS
// AND the desktop Developer ID notarization). So this file is data read at
// BUILD time by vite.config.js, and the hiding mechanism is module-graph
// surgery, not a boolean the app evaluates:
//
//   vite aliases `surfaces/<name>.jsx` -> `surfaces/<name>.hidden.jsx`, whose
//   twin imports NOTHING. The route components of a hidden surface never enter
//   the bundle, so there is nothing left to switch on. That is checkable in the
//   artifact rather than asserted in prose, which is the whole point: a `store`
// label in a signed manifest  has to be earned.
//
// WHAT IS IN THE DEX SURFACE, and what deliberately is not. Everything below
// is a judgment about one App Review question ("is this an exchange?"), so it
// is written down rather than inferred from which files happened to move:
//
//   IN:  the order book and the pair views (markets, market, markets-picker,
//        market-activity), order authoring and management (create-order,
//        my-orders), and the swap lane (swap, my-swaps, cross-chain-swap).
//        These are the screens a reviewer reads as a trading venue.
//   OUT: `coinpay` / `obligations`. They SETTLE an order that already matched.
//        A user holds one seed across shells, so a match made on web can come
//        due while they hold the phone; removing the ability to pay it would
//        strand a real obligation, which is a harm, not a compliance win.
//   OUT: `dispensers`. A dispenser is the user's own vending address, not a
//        venue with counterparties and an order book.
//   OUT: `sell-name`, an ownership transfer priced in coin, reached only from
//        a token you already own.
//   OUT: `bet-markets` and the betting lane. Gambling is a DIFFERENT review
// guideline (5.3) with a different answer, and scopes this to
//        the DEX lane. If that answer comes back "hide it too", it is a
//        `betting` entry in HIDDEN_SURFACES plus a `surfaces/betting.jsx`
//        twin pair - the mechanism does not change.
//
// D2 (§9) is still open: submit v1 WITH the DEX surface and defend it,
// or hide it preemptively. The spec recommends hiding, which is what the table
// below does. Answering D2 the other way is deleting one line here.

/** Profile names are owned by `src/csp.js`; imported so the two cannot drift. */
import { BUILD_PROFILES, DEFAULT_BUILD_PROFILE } from '../csp.js';

export { BUILD_PROFILES, DEFAULT_BUILD_PROFILE };

/** Every surface that CAN be hidden. A name with no twin pair is a build error. */
export const SURFACES = Object.freeze(['dex']);

/**
 * Surfaces each profile compiles OUT. Subtractive, like the CSP beside it: a
 * profile can only ever hold less than the full app, never more, so nothing
 * here can add a surface to a build nobody reviews as closely as the web one.
 *
 * @type {Record<string, readonly string[]>}
 */
export const HIDDEN_SURFACES = Object.freeze({
    default: Object.freeze([]),
    store: Object.freeze(['dex']),
});

/**
 * The views a surface owns. Not used to route (the surface module owns its own
 * routing); used by tests to assert that no hidden view still resolves, and by
 * anyone reading this file to see the blast radius without opening the module.
 *
 * @type {Record<string, readonly string[]>}
 */
export const SURFACE_VIEWS = Object.freeze({
    dex: Object.freeze([
        'markets',
        'markets-picker',
        'market',
        'market-activity',
        'swap',
        'my-swaps',
        'create-order',
        'my-orders',
        'cross-chain-swap',
    ]),
});

/**
 * Route components a hidden surface must not drag into the bundle.
 *
 * The alias swap is what removes them; this list is what PROVES it removed
 * them. `vite.config.js` refuses a build in which any of these modules
 * resolves while the surface is hidden, so a second importer appearing
 * somewhere (the one way the mechanism can silently fail) breaks the build
 * instead of quietly shipping a store artifact with a DEX in it.
 *
 * Shared components a hidden surface merely USES are not listed: ReceivePicker
 * also serves the `receive-picker` view, so its presence proves nothing.
 *
 * @type {Record<string, readonly string[]>}
 */
export const SURFACE_MODULES = Object.freeze({
    dex: Object.freeze([
        'shared/routes/MarketsList.jsx',
        'shared/routes/MarketView.jsx',
        'shared/routes/MarketActivity.jsx',
        'shared/routes/CreateOrderForm.jsx',
        'shared/routes/MyOrdersView.jsx',
        'shared/routes/MySwapsView.jsx',
        'shared/routes/SwapForm.jsx',
        'shared/routes/CrossChainSwapForm.jsx',
    ]),
});

/**
 * Is `surface` compiled into a build of `profile`?
 *
 * Throws on an unknown profile or surface rather than answering, on the same
 * reasoning as `resolveBuildProfile`: a typo that quietly answers "enabled"
 * ships a surface a store build was supposed to drop, and a typo that quietly
 * answers "hidden" ships a web build missing its DEX. Neither is discoverable
 * by looking at the running app.
 *
 * @param {string} surface
 * @param {string} [profile]
 * @returns {boolean}
 */
export function isSurfaceEnabled(surface, profile = DEFAULT_BUILD_PROFILE) {
    if (!SURFACES.includes(surface)) {
        throw new Error(
            `surfaces: unknown surface ${JSON.stringify(surface)};`
            + ` expected one of ${SURFACES.join(', ')}`,
        );
    }
    if (!BUILD_PROFILES.includes(profile)) {
        throw new Error(
            `surfaces: unknown build profile ${JSON.stringify(profile)};`
            + ` expected one of ${BUILD_PROFILES.join(', ')}`,
        );
    }
    return !(HIDDEN_SURFACES[profile] ?? []).includes(surface);
}

/**
 * The surfaces a profile hides, in SURFACES order.
 * @param {string} [profile]
 * @returns {string[]}
 */
export function hiddenSurfacesFor(profile = DEFAULT_BUILD_PROFILE) {
    return SURFACES.filter((s) => !isSurfaceEnabled(s, profile));
}
