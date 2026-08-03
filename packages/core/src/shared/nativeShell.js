// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// "Is this a native shell, and does it have plugin X?" - asked in ONE place.
//
// Two things need this now: the vault bridge in the web shell
// (`packages/web/src/storage/nativeVault.js`,  §1 / ) and the
// clipboard bridge beside this file . A second hand-rolled copy of a
// five-line duck-type probe is exactly the drift was filed about, and
// the two would not drift visibly: both would keep working in a browser, and
// only the native shells - the ones nobody smoke-runs locally - would disagree.
//
// It lives in core rather than in the web shell because its callers do. The
// vault's callers are web's storage backends, so that bridge is in web; the
// clipboard's callers are core UI components, which cannot import from web
// (the dependency runs the other way). What both share is this probe.
//
// The Capacitor GLOBAL is used rather than an `@capacitor/core` import, on
// purpose: it keeps the browser bundle free of a dependency it can never use,
// and it keeps the code honest, because the wallet running at
// wallet.xchain.io genuinely has no native shell and finds no global.

/**
 * Is this the native shell at all, regardless of which plugins registered?
 *
 * Deliberately separate from "does plugin X exist" (: conflating them
 * is what let a broken native build read as an ordinary browser). A page that
 * merely defines `window.Capacitor` - some dApp libraries do - is not a native
 * shell, so the real function has to be there and has to say so.
 *
 * @param {any} [env]  injectable globals for tests
 * @returns {boolean}
 */
export function isNativeShell(env = globalThis) {
    const cap = /** @type {any} */ (env)?.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function') return false;
    return cap.isNativePlatform() === true;
}

/**
 * A registered plugin handle, or null.
 *
 * `method` is the name of a function the plugin must actually expose. Checking
 * a method rather than mere presence is what makes this a contract test rather
 * than a name lookup: a half-registered plugin, or one whose JS-side proxy
 * exists without the native class behind it, answers null instead of
 * pretending.
 *
 * @param {string} name              the plugin's `jsName`
 * @param {{ env?: any, method?: string }} [opts]
 * @returns {Record<string, Function> | null}
 */
export function getNativePlugin(name, { env = globalThis, method } = {}) {
    const cap = /** @type {any} */ (env)?.Capacitor;
    if (!cap) return null;
    if (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform()) return null;
    const plugin = cap.Plugins?.[name];
    if (!plugin) return null;
    if (method && typeof plugin[method] !== 'function') return null;
    return plugin;
}
