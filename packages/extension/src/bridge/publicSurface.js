// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Trust-boundary helpers for the extension's message transport.
//
// The background MessageHost registers TWO classes of handler on the
// same chrome.runtime.onMessage surface:
//
//   - PUBLIC bridge handlers (`bridge.*`): the `window.xchain` dApp
//     surface. Each one enforces per-origin ConnectedSite permissions
//     and routes signing through the approval prompt. Safe to expose to
//     any web origin.
//   - PRIVILEGED handlers (`wallet.*`, `action.*`, `settings.*`,
//     `sites.*`, `auth.*`, `account.*`, ...): the popup/full-screen UI
//     surface. They assume the caller is the trusted extension UI and
//     therefore skip origin checks and reuse the pre-unlocked signer
//     pool WITHOUT a password. Reaching one from a web page is a full
//     wallet compromise (fund drain, wallet deletion, settings tamper).
//
// A content script relays page messages to the background, and web
// pages are the only untrusted senders that can reach it (the manifest
// declares no `externally_connectable`, so pages cannot message the
// background directly). These helpers are the single source of truth
// for "which types are web-reachable" and "is this sender the trusted
// extension UI", used by the content-script relay and by every
// background listener/port so the boundary is enforced identically.

// Every public bridge handler name starts with this namespace. Anything
// outside it is privileged and must never be invoked by a web origin.
export const PUBLIC_BRIDGE_PREFIX = 'bridge.';

/**
 * True when `type` is a public, web-reachable bridge message type.
 *
 * @param {unknown} type
 * @returns {boolean}
 */
export function isPublicBridgeType(type) {
    return typeof type === 'string' && type.startsWith(PUBLIC_BRIDGE_PREFIX);
}

/**
 * True when a chrome messaging `sender` (or a port's `sender`) is one of
 * the extension's own pages (popup / options / full-screen tab), rather
 * than a content script running in a web page.
 *
 * Content scripts and web pages carry an http(s) `origin`/`url`;
 * extension pages carry `chrome-extension://<id>`. `sender.tab` is NOT a
 * reliable discriminator because the extension's own full-screen UI also
 * runs inside a tab, so we key strictly on the sender origin matching our
 * own extension id. Missing/opaque sender info fails closed (untrusted).
 *
 * @param {{ origin?: string, url?: string } | null | undefined} sender
 * @param {string | null | undefined} runtimeId   chrome.runtime.id
 * @returns {boolean}
 */
export function isTrustedExtensionSender(sender, runtimeId) {
    if (!sender || typeof runtimeId !== 'string' || runtimeId.length === 0) {
        return false;
    }
    const extOrigin = `chrome-extension://${runtimeId}`;
    if (typeof sender.origin === 'string' && sender.origin.length > 0) {
        return sender.origin === extOrigin;
    }
    // Fall back to the frame URL when `origin` is unavailable on this
    // Chrome build. An extension page's URL is `chrome-extension://<id>/…`.
    if (typeof sender.url === 'string' && sender.url.length > 0) {
        return sender.url === extOrigin || sender.url.startsWith(`${extOrigin}/`);
    }
    return false;
}

/**
 * Decide whether a message of `type` from `sender` may reach the
 * background handler surface. Trusted extension pages may call anything;
 * every other sender (web page via content script) is confined to the
 * public `bridge.*` surface.
 *
 * @param {unknown} type
 * @param {{ origin?: string, url?: string } | null | undefined} sender
 * @param {string | null | undefined} runtimeId
 * @returns {boolean}
 */
export function isMessageAllowedFromSender(type, sender, runtimeId) {
    if (isTrustedExtensionSender(sender, runtimeId)) return true;
    return isPublicBridgeType(type);
}
