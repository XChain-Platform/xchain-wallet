// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What the surrounding shell can actually do .
//
// Shared UI runs in three hosts with genuinely different powers, and the
// wallet had no way to say so. That is not a cosmetic gap: it is how a
// "Tor routing" toggle came to be shown in all three shells while being
// implementable in exactly one, promising every user something only
// desktop users could get.
//
// DEFAULT FALSE, ALWAYS. A shell opts IN by declaring what it supports.
// A capability that defaults to true would silently reappear in the next
// shell someone adds, which is the bug this module exists to prevent.

/**
 * @typedef {Object} ShellCapabilities
 * @property {boolean} socksProxy
 *   The host can route the wallet's own outbound requests through a
 *   SOCKS5 proxy. True on desktop, where the SDK runs in the Electron
 *   main process and its sockets are ours to open. False in a browser
 *   page, which exposes no proxy API to script at all, and false in an
 *   MV3 extension, where `chrome.proxy` would reroute the user's ENTIRE
 *   browser rather than the wallet's requests.
 */

/** @type {ShellCapabilities} */
const NONE = Object.freeze({ socksProxy: false });

let current = NONE;

/**
 * Declare what this shell supports. Called once, at shell boot.
 * @param {Partial<ShellCapabilities>} next
 */
export function setShellCapabilities(next) {
    current = Object.freeze({ ...NONE, ...(next ?? {}) });
}

/** @returns {ShellCapabilities} */
export function shellCapabilities() {
    return current;
}

/** Test helper: forget any declaration, back to "supports nothing". */
export function resetShellCapabilities() {
    current = NONE;
}
