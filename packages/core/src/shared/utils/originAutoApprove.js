// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// originAutoApprove (§48.6 / G151 + Cluster Q FOLLOWUP 3): Helpers that
// decide whether a dApp bridge request from a given origin should be
// auto-approved without prompting the user.
//
// Two independent gates, both off by default and both localhost-only:
//   - shouldAutoApproveConnect: `connect` skips the permission prompt.
//   - shouldAutoApproveSign: a sign request may reuse a password the user
//     already entered this session (held by the bridge's signPasswordCache)
//     instead of prompting again. Sign still requires the password to unwrap
//     the seed; auto-sign reuses a cached one, it never signs without it.
//
// A `connect` qualifies for auto-approve when ALL of:
//   - settings.developerMode === true
//   - settings.autoApproveLocalhost === true (v2-tolerant optional field)
//   - origin parses as `localhost`, `127.0.0.1`, or `[::1]` on http(s),
//     any port (Vite dev servers spin up random ports; we don't pin one).
//
// A sign request qualifies for auto-sign when ALL of:
//   - settings.developerMode === true
//   - settings.autoSignLocalhostMs is a positive number (the user-chosen
//     cache timeout; absent / 0 = off, which is the default)
//   - the origin is localhost (same test as above).
//
// Anything else returns false. The caller falls back to the normal
// approvals prompt. Auto-approve is a developer ergonomics affordance,
// not a security override.

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

/**
 * Whether a sign request from `origin` may reuse a session-cached password
 * (Developer-Mode localhost auto-sign, Cluster Q FOLLOWUP 3) instead of
 * prompting. This is a SEPARATE opt-in from connect auto-approve: a user can
 * auto-approve connect without ever enabling auto-sign, and vice versa.
 *
 * The timeout doubles as the on/off switch: any positive `autoSignLocalhostMs`
 * enables it, absent / 0 disables it. Default settings omit the field, so
 * auto-sign is off until the user deliberately picks a timeout.
 *
 * @param {object} args
 * @param {string | null | undefined} args.origin
 * @param {{ developerMode?: boolean, autoSignLocalhostMs?: number } | null | undefined} args.settings
 * @returns {boolean}
 */
export function shouldAutoApproveSign({ origin, settings }) {
    if (!settings) return false;
    if (!settings.developerMode) return false;
    const ttl = settings.autoSignLocalhostMs;
    if (!Number.isFinite(ttl) || ttl <= 0) return false;
    return isLocalhostOrigin(origin);
}

/**
 * Resolve the concrete permission scope an auto-approved connect may be granted.
 *
 * The permission model (§43.3) reads an EMPTY `chains` / `accounts` list as a
 * wildcard: `assertChainPermitted` returns early on `chains.length === 0`, and
 * `getAccounts` / `getAddresses` fall back to every account when the account set
 * is empty. Auto-approve therefore must never store an empty list. Echoing the
 * dApp's request back verbatim has the same defect from the other side: a
 * `connect()` that names no chains or accounts (the common case) would persist a
 * wildcard read grant over every chain and every account, without a prompt.
 *
 * So the scope is resolved from the WALLET's state, then narrowed by the
 * request, never widened by it:
 *   - chains:   the request intersected with the user's active-network chains,
 *               or all active-network chains when the request names none.
 *   - accounts: the request intersected with real account ids, or the primary
 *               account alone when the request names none. A dApp cannot
 *               enumerate the user's other accounts by asking for nothing.
 *
 * Returns null when no meaningful grant can be synthesized (no active chains, no
 * accounts, or the request asks only for things the wallet doesn't have). The
 * caller falls back to the approval prompt rather than guessing.
 *
 * @param {object} args
 * @param {unknown} args.requestedChains     req.chains as received from the dApp
 * @param {unknown} args.requestedAccounts   req.accounts as received from the dApp
 * @param {string[]} args.activeChainIds     chain ids on the user's active network
 * @param {string[]} args.accountIds         account ids that exist in the vault, primary first
 * @returns {{ chains: string[], accounts: string[] } | null}
 */
export function resolveAutoApproveScope({
    requestedChains,
    requestedAccounts,
    activeChainIds,
    accountIds,
}) {
    const ids = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.length > 0) : []);
    const active = ids(activeChainIds);
    const accounts = ids(accountIds);
    if (active.length === 0 || accounts.length === 0) return null;

    const wantChains = ids(requestedChains);
    const chains = wantChains.length > 0
        ? active.filter((c) => wantChains.includes(c))
        : [...active];

    const wantAccounts = ids(requestedAccounts);
    const granted = wantAccounts.length > 0
        ? accounts.filter((a) => wantAccounts.includes(a))
        : [accounts[0]];

    if (chains.length === 0 || granted.length === 0) return null;
    return { chains, accounts: granted };
}
