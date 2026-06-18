// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// originAutoApprove (§48.6 / G151): Helpers that decide whether a
// dApp bridge `connect` request from a given origin should be
// auto-approved without prompting the user.
//
// Scope: connect-only. Sign requests (signMessage, signAction,
// signPsbt, signIn) ALWAYS go through the approval prompt: the
// password is required to unwrap the seed and we deliberately never
// cache it. Auto-approve is a developer ergonomics affordance, not a
// security override.
//
// A request qualifies for auto-approve when ALL of:
//   - settings.developerMode === true
//   - settings.autoApproveLocalhost === true (v2-tolerant optional field)
//   - origin parses as `localhost`, `127.0.0.1`, or `[::1]` on http(s),
//     any port (Vite dev servers spin up random ports; we don't pin one).
//
// Anything else returns false. The caller falls back to the normal
// approvals prompt.

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * @param {string | null | undefined} origin    e.g. "http://localhost:5173"
 * @returns {boolean}
 */
export function isLocalhostOrigin(origin) {
    if (typeof origin !== 'string' || origin.length === 0) return false;
    let parsed;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
    // URL.hostname strips the brackets from `[::1]` so we have to test
    // the bare form too. `localhost` and `127.0.0.1` come through verbatim.
    const host = parsed.hostname;
    return LOCALHOST_HOSTNAMES.has(host) || host === '::1';
}

/**
 * @param {object} args
 * @param {string | null | undefined} args.origin
 * @param {{ developerMode?: boolean, autoApproveLocalhost?: boolean } | null | undefined} args.settings
 * @returns {boolean}
 */
export function shouldAutoApproveConnect({ origin, settings }) {
    if (!settings) return false;
    if (!settings.developerMode) return false;
    if (!settings.autoApproveLocalhost) return false;
    return isLocalhostOrigin(origin);
}
