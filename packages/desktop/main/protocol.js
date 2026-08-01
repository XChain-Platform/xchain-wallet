// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// URI scheme registration + deep-link dispatch: §40.12 Step 19.
//
// Two-tier model the user signed off on:
//
//   Tier 1: `xchain:`
//     Claimed unconditionally on every launch. No conflict with
//     existing wallets; XChain-branded. `setAsDefaultProtocolClient`
//     is safe to call repeatedly; the OS updates the handler if needed.
//
//   Tier 2: `bitcoin:`, `litecoin:`, `dogecoin:`
//     electron-builder's `protocols` config declares them at install
//     time (so the OS knows we CAN handle them). At runtime we only
//     call `setAsDefaultProtocolClient` if the user has opted in via
//     settings (default OFF). The settings UI surface for the opt-in
//     toggle lands in a later step; for now this module exposes a
//     public API (`setCoinSchemeOptIn`) that a future settings
//     handler can call.
//
// Deep-link dispatch is cross-platform but the OS events differ:
//
//   macOS         → `app.on('open-url')` fires whenever a URI comes in
//                   (app open or already-running). Single-instance by
//                   default.
//   Windows/Linux → On open the URL is appended to `process.argv`.
//                   Subsequent opens trigger `app.on('second-instance')`.
//                   We use `app.requestSingleInstanceLock()` to
//                   consolidate into the already-running window.
//
// Parsed URIs post to the renderer via webContents.send('xchain:uri', …)
// where renderer-side code routes to the appropriate view (Send form
// for payment URIs, action preview for xchain: URIs).

import { parseBip21Uri, InvalidBip21Error } from '../../core/src/uri/bip21.js';
import { parseXchainUri, hardenUriIntentText } from '../../core/src/uri/xchainUri.js';

/** URI schemes the app is allowed to claim. */
export const TIER_1_SCHEME = 'xchain';
export const TIER_2_SCHEMES = Object.freeze(['bitcoin', 'litecoin', 'dogecoin']);
export const ALL_SCHEMES = Object.freeze([TIER_1_SCHEME, ...TIER_2_SCHEMES]);

/**
 * Claim the unconditional Tier-1 scheme (`xchain:`) + any Tier-2
 * schemes the user has opted into. Called once on `app.whenReady`.
 *
 * @param {import('electron').App} app
 * @param {Object} [opts]
 * @param {string[]} [opts.optedInSchemes]  Tier-2 schemes to claim (default none)
 */
export function registerProtocolClients(app, opts = {}) {
    if (!app || typeof app.setAsDefaultProtocolClient !== 'function') {
        throw new Error('registerProtocolClients: invalid Electron app handle');
    }
    app.setAsDefaultProtocolClient(TIER_1_SCHEME);

    const optedIn = new Set(opts.optedInSchemes ?? []);
    for (const scheme of TIER_2_SCHEMES) {
        if (optedIn.has(scheme)) {
            app.setAsDefaultProtocolClient(scheme);
        } else {
            // `removeAsDefaultProtocolClient` is a no-op if we're not
            // currently the default; safe to call unconditionally.
            // Not all platforms implement it (macOS returns false);
            // that's fine, the runtime toggle just doesn't have effect
            // on that platform until a settings-UI handler is wired up.
            if (typeof app.removeAsDefaultProtocolClient === 'function') {
                try { app.removeAsDefaultProtocolClient(scheme); } catch (_err) { /* best-effort */ }
            }
        }
    }
}

/**
 * Placeholder for the future settings-UI opt-in toggle. A later step
 * will wire this to a persisted preference in the vault's settings
 * slot; for now it just re-runs `registerProtocolClients` with the
 * current opt-in set.
 *
 * @param {import('electron').App} app
 * @param {string[]} optedInSchemes
 */
export function updateCoinSchemeOptIn(app, optedInSchemes) {
    registerProtocolClients(app, { optedInSchemes });
}

/**
 * Wire deep-link listeners + single-instance lock. The `onDeepLink`
 * callback receives `{ scheme, raw, parsed }`: raw URI string plus
 * the parsed BIP21 shape (or null for `xchain:` URIs, which the
 * renderer parses via its own action decoder).
 *
 * @param {import('electron').App} app
 * @param {{ onDeepLink: (evt: DeepLinkEvent) => void }} opts
 * @returns {{ gotLock: boolean }}  false means another instance already holds it and we should quit
 *
 * @typedef {Object} DeepLinkEvent
 * @property {string} scheme                  lowercased; one of ALL_SCHEMES
 * @property {string} raw                     the URI as received
 * @property {import('../../../core/src/uri/bip21.js').Bip21Uri | null} parsed   non-null for bitcoin/litecoin/dogecoin
 */
export function attachDeepLinkHandlers(app, { onDeepLink }) {
    if (typeof onDeepLink !== 'function') {
        throw new Error('attachDeepLinkHandlers: onDeepLink must be a function');
    }

    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) return { gotLock: false };

    // macOS open-url: fires on launch + while running.
    app.on('open-url', (event, url) => {
        event.preventDefault();
        dispatch(url, onDeepLink);
    });

    // Windows/Linux subsequent launches: the OS passes the URL through
    // the second-instance's argv. We scan for anything matching our
    // schemes and dispatch.
    app.on('second-instance', (_event, argv, _cwd) => {
        const url = findDeepLinkInArgv(argv);
        if (url) dispatch(url, onDeepLink);
    });

    // First-launch URL (Windows/Linux): may already be on our own argv.
    const initial = findDeepLinkInArgv(process.argv);
    if (initial) {
        // Defer to after whenReady so the renderer exists; `app.whenReady`
        // resolving is the caller's responsibility; we just queue on
        // next tick so the caller can attach listeners after us.
        setImmediate(() => dispatch(initial, onDeepLink));
    }

    return { gotLock: true };
}

/**
 * Parse + classify a URI. Exposed for tests; also called from the
 * dispatch path internally.
 *
 * @param {string} url
 * @returns {DeepLinkEvent | null}
 */
export function classifyDeepLink(url) {
    if (typeof url !== 'string' || !url) return null;
    const colon = url.indexOf(':');
    if (colon < 0) return null;
    const scheme = url.slice(0, colon).toLowerCase();
    if (!ALL_SCHEMES.includes(scheme)) return null;

    if (scheme === TIER_1_SCHEME) {
        // §47.4 / G145: parse the URI into an actionable intent so the
        // renderer doesn't have to re-classify. Falls back to `parsed: null`
        // when the parser returns `kind: 'unknown'` so the renderer can
        // still surface a generic "couldn't parse" message.
        //
        //  §3.6: hardened here rather than in the renderer because
        // this is where an OS-supplied URI crosses into our process, and
        // the intent goes out over IPC. The renderer has no listener yet,
        // so nothing consumes this today; hardening now means whoever
        // wires that listener inherits a neutralized intent instead of
        // having to know they needed one.
        const intent = hardenUriIntentText(parseXchainUri(url));
        return {
            scheme,
            raw: url,
            parsed: intent.kind === 'unknown' ? null : intent,
        };
    }

    // Tier-2 (coin) URIs: parse via BIP21. A malformed URI surfaces
    // as `parsed: null` so the renderer can display a clear error
    // instead of silently ignoring the click.
    try {
        const parsed = parseBip21Uri(url);
        // BIP21: a `req-*` param the wallet does not implement invalidates the
        // whole URI. XChain implements none, so reject (parsed: null) rather
        // than dropping the required directive and paying a plain send.
        if (parsed.required?.length > 0) {
            return { scheme, raw: url, parsed: null };
        }
        return { scheme, raw: url, parsed };
    } catch (err) {
        if (err instanceof InvalidBip21Error) {
            return { scheme, raw: url, parsed: null };
        }
        throw err;
    }
}

function dispatch(url, onDeepLink) {
    const event = classifyDeepLink(url);
    if (event) onDeepLink(event);
}

function findDeepLinkInArgv(argv) {
    if (!Array.isArray(argv)) return null;
    // electron-builder's NSIS + Linux launchers forward the URL as the
    // last arg, but the exact position isn't guaranteed. Scan the
    // whole argv for anything that starts with one of our schemes.
    for (const arg of argv) {
        if (typeof arg !== 'string') continue;
        const colon = arg.indexOf(':');
        if (colon < 1) continue;
        const scheme = arg.slice(0, colon).toLowerCase();
        if (ALL_SCHEMES.includes(scheme)) return arg;
    }
    return null;
}
