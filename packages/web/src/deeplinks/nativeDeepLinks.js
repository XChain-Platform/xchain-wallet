// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Deep-link intake for the native shells ( §1, stage S3).
//
// On the web a link arrives as `?uri=` in the query string and the SPA reads
// it once at mount. There is no query string to read when Android hands the
// app an intent, so this module subscribes to the native side and feeds the
// SAME handler. Reusing that handler is the point: it is where the parsing,
// the text hardening and the unlock gating already live, and a second intake
// path would be a second place for those to be forgotten.
//
// LINK DATA IS HOSTILE INPUT. Anyone can put a QR code on a poster, and any
// app on the device can fire an `xchain:` intent at us. The invariants (§1):
//
//   - a link NEVER bypasses the unlock screen. Nothing here unlocks
//     anything; the payload becomes prefill, and the shared App only applies
//     the pending view once the session reports unlocked.
//   - a link NEVER auto-advances into a signing or connect flow. The shared
//     handler routes to send / receive / contract-execute FORMS, all of
//     which still require the user to press the button. Kinds outside that
//     set are refused here as well, so a future parser that learns to
//     recognize a "connect" or "sign" URI does not silently gain the ability
//     to be triggered by one.
//   - every extracted parameter is re-displayed for confirmation, which is
//     what a prefilled form is.
//
// The scheme half deserves saying out loud: `xchain:` can be claimed by any
// app, so a link under it might have been aimed at a lookalike wallet and
// bounced to us, or aimed at us by malware. Accepting it inbound is a
// compatibility decision, not a trust decision. Nothing about a link is
// treated as authenticated, no matter which shape it arrived in.

/** Plugin name registered by XChainLinksPlugin.java. */
export const LINKS_PLUGIN = 'XChainLinks';

/** The link shapes this app claims in its manifest, and nothing else. */
const ALLOWED_HTTPS_ORIGIN = 'https://xchain.io';
const ALLOWED_HTTPS_PREFIX = '/wallet';
const APP_SCHEME = 'xchain:';

/**
 * A URL is worth handing to the parser only if it is one we claim. The native
 * side checks this too; this is the half that still runs when the plugin is
 * ever replaced, and the half a unit test can drive.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function isAcceptableDeepLink(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 4096) return false;
    const lower = url.toLowerCase();
    if (lower.startsWith(APP_SCHEME)) return true;
    if (!lower.startsWith(`${ALLOWED_HTTPS_ORIGIN}/`)) return false;
    // Parse rather than prefix-match the path: `https://xchain.io.evil.com/`
    // and `https://xchain.io@evil.com/` both pass a naive startsWith.
    try {
        const parsed = new URL(url);
        return parsed.origin === ALLOWED_HTTPS_ORIGIN
            && parsed.pathname.startsWith(ALLOWED_HTTPS_PREFIX);
    } catch (_err) {
        return false;
    }
}

/** @returns {Record<string, Function> | null} */
function linksPlugin() {
    if (injectedForTests !== undefined) return injectedForTests;
    const cap = /** @type {any} */ (globalThis).Capacitor;
    if (!cap) return null;
    if (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform()) return null;
    const plugin = cap.Plugins?.[LINKS_PLUGIN];
    return plugin && typeof plugin.takePendingLink === 'function' ? plugin : null;
}

/** @type {Record<string, Function> | null | undefined} */
let injectedForTests;

/** Test seam. `undefined` restores real detection; `null` forces "browser". */
export function __setLinksPluginForTests(plugin) {
    injectedForTests = plugin;
}

/**
 * Subscribe to native deep links.
 *
 * Collects the link that LAUNCHED the app (queued natively, because it
 * arrives long before any JS exists) and then listens for taps that arrive
 * while the app is running. Returns an unsubscribe function; safe to call in
 * a browser, where it does nothing and returns a no-op.
 *
 * @param {(url: string) => void} onLink
 * @returns {() => void}
 */
export function subscribeToNativeDeepLinks(onLink) {
    const plugin = linksPlugin();
    if (!plugin || typeof onLink !== 'function') return () => {};

    let disposed = false;
    const deliver = (url) => {
        if (disposed) return;
        if (!isAcceptableDeepLink(url)) return;
        onLink(url);
    };

    // The cold-start link first. A tap that launches the app is the common
    // case on mobile, and it is exactly the one an event-only design drops.
    Promise.resolve(plugin.takePendingLink())
        .then((reply) => { if (reply?.url) deliver(reply.url); })
        .catch(() => { /* no queued link, or an older shell build */ });

    let handle;
    try {
        handle = plugin.addListener?.('xchainUrlOpen', (event) => deliver(event?.url));
    } catch (_err) {
        handle = null;
    }

    return () => {
        disposed = true;
        Promise.resolve(handle)
            .then((h) => h?.remove?.())
            .catch(() => { /* already gone */ });
    };
}
