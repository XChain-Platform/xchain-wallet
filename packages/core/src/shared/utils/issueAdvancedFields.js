// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * The ISSUE fields that are configurable at CREATE time but that the
 * wizard historically only exposed on the post-create admin edits
 * (PC-02 lock matrix / PC-03 callback / PC-04 access lists).
 *
 * ISSUE v0 carries the whole set on the wire:
 *
 *   VERSION|TICK|MAX_SUPPLY|MAX_MINT|DECIMALS|DESCRIPTION|MINT_SUPPLY|
 *   TRANSFER|TRANSFER_SUPPLY|LOCK_MAX_SUPPLY|LOCK_MAX_MINT|
 *   LOCK_DESCRIPTION|LOCK_SLEEP|LOCK_CALLBACK|CALLBACK_BLOCK|
 *   CALLBACK_TICK|CALLBACK_AMOUNT|ALLOW_LIST|BLOCK_LIST|
 *   MINT_ADDRESS_MAX|MINT_START_BLOCK|MINT_STOP_BLOCK|LOCK_MINT|
 *   LOCK_MINT_SUPPLY|MEMO
 *
 * so PC-06 is a form pass, not a protocol change: everything below
 * rides the create transaction the wizard already sends.
 *
 * WHY THIS VALIDATES HARDER THAN THE ADMIN EDITS: on an edit, a
 * rejected field costs the edit. On a create, every field shares ONE
 * action, so a single bad advanced value makes the whole ISSUE index
 * invalid and the token is never created (the fee is spent either
 * way). Several indexer guards also do not run on a create, because
 * they are written as `tokenInfo && ...` and there is no token record
 * yet - the callback future-block check (issue.js "Verify
 * CALLBACK_BLOCK is greater than current block index") is the
 * dangerous one, so it is enforced here instead.
 */

/**
 * The seven one-way lock flags (ISSUE.md "Version 3 - Edit LOCK
 * PARAMS"). `key` matches the `locks` field name getToken returns
 * (xchain-explorer db.js "Group LOCK fields"); `field` is the ISSUE
 * wire param. Every flag is one-way: issue.js's `isValidLock` only
 * ever allows 0->1 or a no-op re-affirm of the current value, never
 * 1->0, so once a flag is set on the token record it can never be
 * cleared again.
 *
 * Shared by the admin lock matrix (PC-02, editing an existing token)
 * and the create wizard's advanced panel (PC-06, setting flags at
 * issuance) so the two matrices cannot drift apart.
 */
export const LOCK_FLAGS = [
    {
        key: 'max_supply',
        field: 'LOCK_MAX_SUPPLY',
        label: 'Max supply',
        hint: 'Freezes MAX_SUPPLY. The cap can never be raised again.',
    },
    {
        key: 'max_mint',
        field: 'LOCK_MAX_MINT',
        label: 'Max mint per transaction',
        hint: 'Freezes MAX_MINT. The per-transaction mint cap can never change again.',
    },
    {
        key: 'mint',
        field: 'LOCK_MINT',
        label: 'Minting',
        hint: 'Permanently disables the MINT command. No one will ever be able to mint this token again.',
    },
    {
        key: 'mint_supply',
        field: 'LOCK_MINT_SUPPLY',
        label: 'Mint supply now',
        hint: 'Permanently disables MINT_SUPPLY (mint-now via a token update). The owner can never mint additional supply that way again.',
    },
    {
        key: 'description',
        field: 'LOCK_DESCRIPTION',
        label: 'Description',
        hint: 'Freezes DESCRIPTION. The token metadata can never be edited again.',
    },
    {
        key: 'sleep',
        field: 'LOCK_SLEEP',
        label: 'Sleep',
        hint: 'Permanently disables the SLEEP command for this token.',
    },
    {
        key: 'callback',
        field: 'LOCK_CALLBACK',
        label: 'Callback',
        hint: 'Freezes the callback configuration (block, token, and amount). It can never change again.',
    },
];

/**
 * @typedef {Object} AdvancedIssueFields
 * @property {Record<string, boolean>} [lockChecks]   keyed by LOCK_FLAGS[].key
 * @property {string} [callbackTick]
 * @property {string} [callbackAmount]
 * @property {string} [callbackBlock]
 * @property {string} [allowListIdx]                  ACTION_INDEX of a published TYPE=2 list
 * @property {string} [blockListIdx]
 */

const TICKER_RE = /^[A-Za-z0-9.]+$/;
const WHOLE_RE = /^\d+$/;

function text(value) {
    return String(value ?? '').trim();
}

/**
 * Fractional digits carried by a decimal string ("1.250" -> 3).
 * Used against a token's divisibility, because the indexer rejects an
 * amount carrying more fractional digits than the tick's decimals
 * (utility.js FRACTIONAL-PRECISION-CAP).
 *
 * @param {string} value
 * @returns {number}
 */
export function fractionalDigits(value) {
    const [, frac] = text(value).split('.');
    return frac ? frac.length : 0;
}

/**
 * Fold the advanced create-time fields into an ISSUE v0 params object,
 * in place, and return it.
 *
 * Blank / unchecked entries emit NOTHING rather than an explicit zero:
 * at create there is no prior value to preserve, an absent field is
 * simply unset, and an explicit `LOCK_* = 0` is a field the indexer
 * has had to special-case before (issue.js LOCK_MAX_SUPPLY_EXACT).
 *
 * @param {Record<string, string>} params
 * @param {AdvancedIssueFields | null | undefined} advanced
 * @returns {Record<string, string>}
 */
export function applyAdvancedIssueFields(params, advanced) {
    if (!advanced) return params;
    const checks = advanced.lockChecks || {};
    for (const f of LOCK_FLAGS) {
        if (checks[f.key]) params[f.field] = '1';
    }
    const tick = text(advanced.callbackTick).toUpperCase();
    const amount = text(advanced.callbackAmount);
    const block = text(advanced.callbackBlock);
    if (tick) params.CALLBACK_TICK = tick;
    if (amount) params.CALLBACK_AMOUNT = amount;
    if (block) params.CALLBACK_BLOCK = block;
    const allow = text(advanced.allowListIdx);
    const deny = text(advanced.blockListIdx);
    if (allow) params.ALLOW_LIST = allow;
    if (deny) params.BLOCK_LIST = deny;
    return params;
}

/**
 * Pre-flight the advanced fields against the rules the indexer applies
 * to a CREATE, plus the two it skips on a create but that would leave
 * the user with a token they did not intend.
 *
 * @param {AdvancedIssueFields | null | undefined} advanced
 * @param {object} ctx
 * @param {string} [ctx.supply]                declared MAX_SUPPLY from the wizard
 * @param {number | null} [ctx.currentHeight]  chain tip, when known
 * @param {number | null} [ctx.callbackTickDecimals]  divisibility of the callback token,
 *                                             null when it could not be proven
 * @returns {string | null}                    error text, or null when the fields are safe
 */
export function validateAdvancedIssueFields(advanced, ctx = {}) {
    if (!advanced) return null;
    const { supply, currentHeight = null, callbackTickDecimals = null } = ctx;
    const checks = advanced.lockChecks || {};

    const tick = text(advanced.callbackTick);
    const amount = text(advanced.callbackAmount);
    const block = text(advanced.callbackBlock);
    const anyCallback = !!(tick || amount || block);

    // A create has no "leave blank to keep the current setting": the
    // three callback fields are only meaningful together, and a token
    // issued with a partial config can never fire its callback.
    if (anyCallback && !(tick && amount && block)) {
        return 'A callback needs all three: a payout token, a payout amount, and the block it unlocks at. Fill all three, or clear them to create the token without a callback.';
    }

    if (tick && !TICKER_RE.test(tick)) {
        return 'Callback token must be a valid ticker (A–Z, 0–9, and "." for subtokens).';
    }

    if (amount) {
        if (!(Number(amount) > 0)) {
            return 'Callback payout per unit must be a positive number.';
        }
        const digits = fractionalDigits(amount);
        // The indexer prices CALLBACK_AMOUNT in the CALLBACK TOKEN's
        // decimals, and falls back to 0 decimals when that token does
        // not exist yet (issue.js `callback_decimals`). A whole number
        // is valid at every divisibility, so anything we cannot prove
        // divisible is held to whole numbers - the direction that
        // always composes a valid ISSUE.
        if (digits > 0) {
            if (callbackTickDecimals == null) {
                return `Callback payout must be a whole number unless ${tick || 'the callback token'} is a token the wallet can confirm is divisible. A fractional payout on a token the network reads as indivisible makes the whole creation invalid, and the token is never created.`;
            }
            if (digits > callbackTickDecimals) {
                return `Callback payout carries ${digits} decimal places but ${tick} only has ${callbackTickDecimals}. Round it to ${callbackTickDecimals} decimal place${callbackTickDecimals === 1 ? '' : 's'}.`;
            }
        }
    }

    if (block) {
        if (!WHOLE_RE.test(block)) {
            return 'Callback block must be a whole block height.';
        }
        // The indexer's own future-block guard is written as
        // `tokenInfo && ...`, so it does NOT run on a create. Without
        // this rail a token could be issued with a callback already
        // unlocked, letting the owner recall every holder's balance
        // the moment supply moves.
        if (currentHeight != null && Number(block) <= currentHeight) {
            return `Callback block must be in the future. The chain is at block ${currentHeight.toLocaleString('en-US')}; a callback set at or below that is live the moment the token is created.`;
        }
    }

    // issue.js refuses LOCK_MAX_SUPPLY without a declared cap ("invalid:
    // LOCK_MAX_SUPPLY (no max supply)"), and that guard DOES run on a
    // create.
    if (checks.max_supply && !text(supply)) {
        return 'Locking max supply needs a supply to lock. Enter a supply, or clear that lock.';
    }

    return null;
}

/**
 * Non-blocking cautions for advanced choices that are legal, permanent,
 * and easy to make by accident. Rendered next to the fields rather than
 * gating submit: each one is a real thing an issuer may want.
 *
 * @param {AdvancedIssueFields | null | undefined} advanced
 * @returns {string[]}
 */
export function advancedIssueWarnings(advanced) {
    if (!advanced) return [];
    const out = [];
    const checks = advanced.lockChecks || {};
    const hasCallback = !!(text(advanced.callbackTick)
        && text(advanced.callbackAmount)
        && text(advanced.callbackBlock));
    if (checks.callback && !hasCallback) {
        out.push('You are locking the callback with no callback configured. This token will never be able to have one - a permanent promise to holders that you can never recall their balances.');
    }
    if (checks.callback && hasCallback) {
        out.push('You are locking the callback settings you entered above. The payout token, amount, and block can never be changed again.');
    }
    if (checks.mint && checks.mint_supply) {
        out.push('Minting and mint-now are both locked, so this token\'s supply is fixed at whatever is created in this transaction.');
    }
    if (advanced.allowListIdx) {
        out.push('An allow-list means ONLY addresses on that list can hold or trade this token. The list can be replaced later, but never removed.');
    }
    return out;
}
