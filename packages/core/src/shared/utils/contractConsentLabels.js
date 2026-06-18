// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase F: plain-language mapping for the inline consent disclosure.
//
// A contract's permissions manifest declares which ACTION TYPES the
// contract is allowed to emit (the indexer enforces it). Those wire
// names (SEND, ISSUE, DISPENSER, …) mean nothing to a non-technical
// wallet user, so we translate each into a short plain verb phrase
// before showing it on the review screen.
//
// Both functions are pure and synchronous; unit-tested in
// test/unit/flows/contractConsentLabels.test.js.

import {
    COMMON_ACTIONS,
    BTC_EXCLUSIVE_ACTIONS,
} from '../../registry/actions.js';

// Canonical action-type → plain verb. Keys cover every action the
// platform protocol defines (COMMON_ACTIONS + BTC_EXCLUSIVE_ACTIONS);
// an unmapped/unknown permission falls back to a lower-cased form of
// the raw token so a future action still renders something readable
// rather than being silently dropped.
const VERB_MAP = /** @type {Record<string, string>} */ ({
    AIRDROP: 'airdrop tokens',
    BATCH: 'submit batched actions',
    BROADCAST: 'publish broadcasts',
    CALLBACK: 'run callbacks',
    COINPAY: 'take coin payments',
    DESTROY: 'destroy tokens',
    DISPENSER: 'run dispensers',
    DIVIDEND: 'pay dividends',
    FILE: 'store files',
    ISSUE: 'issue tokens',
    LINK: 'link content',
    LIST: 'manage lists',
    MESSAGE: 'send messages',
    MINT: 'mint tokens',
    ORDER: 'place orders',
    PRICE: 'publish prices',
    SEND: 'send your tokens',
    SLEEP: 'schedule delays',
    SWAP: 'swap tokens',
    SWEEP: 'sweep balances',
    // BTC-exclusive (staking + smart-contract sub-actions)
    COLLECT: 'collect staking rewards',
    DELEGATE: 'delegate stake',
    DEPLOY: 'deploy contracts',
    DEPOSIT: 'receive deposits',
    EXECUTE: 'call other contracts',
    STAKE: 'stake tokens',
    UNSTAKE: 'unstake tokens',
    WITHDRAW: 'withdraw tokens',
});

// Sanity: keep VERB_MAP in step with the protocol action lists. This is
// a build-time guard for maintainers, not a runtime path; it never
// throws (an unmapped action still degrades to a humanized fallback).
export const KNOWN_ACTION_TYPES = /** @type {readonly string[]} */ ([
    ...COMMON_ACTIONS,
    ...BTC_EXCLUSIVE_ACTIONS,
]);

/**
 * Humanize a single permission token: known action → mapped verb,
 * otherwise the raw token lower-cased with separators normalized.
 *
 * @param {string} perm
 * @returns {string}
 */
function verbFor(perm) {
    const key = String(perm).trim().toUpperCase();
    if (VERB_MAP[key]) return VERB_MAP[key];
    return String(perm).trim().toLowerCase().replace(/[_-]+/g, ' ');
}

/**
 * Map a manifest's `permissions` array into a sorted, de-duplicated
 * list of plain-language verb phrases.
 *
 *   - `null`  → `null`  (the contract declared NO restriction; it can
 *               do anything; the caller renders that as "unrestricted").
 *   - `[]`    → `[]`    (declared an EMPTY allowlist; can do nothing).
 *   - array   → sorted unique verbs; non-string / blank entries dropped.
 *
 * Sorted alphabetically by the rendered verb for a stable, readable
 * list regardless of manifest ordering.
 *
 * @param {string[] | null | undefined} permissions
 * @returns {string[] | null}
 */
export function permissionsToVerbs(permissions) {
    if (permissions === null || permissions === undefined) return null;
    if (!Array.isArray(permissions)) return null;
    const verbs = permissions
        .filter((p) => typeof p === 'string' && p.trim() !== '')
        .map(verbFor);
    return Array.from(new Set(verbs)).sort((a, b) => a.localeCompare(b));
}

/**
 * Render a basis-points fee cap as a human percentage string.
 *
 *   300  → "3%"
 *   1250 → "12.5%"
 *   0    → "0%"
 *   null → null  (no declared cap)
 *
 * Trailing zeros are trimmed (300 → "3%", not "3.00%"). Non-finite /
 * negative inputs return null rather than rendering garbage.
 *
 * @param {number | null | undefined} bps
 * @returns {string | null}
 */
export function bpsToPercent(bps) {
    if (bps === null || bps === undefined) return null;
    const n = Number(bps);
    if (!Number.isFinite(n) || n < 0) return null;
    const pct = n / 100;
    // Trim to at most 2 decimals, then strip trailing zeros + dot.
    const str = pct.toFixed(2).replace(/\.?0+$/, '');
    return `${str}%`;
}
