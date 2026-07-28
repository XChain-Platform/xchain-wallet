// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CoSignerAccount (§22, P4 passive co-signer). A wallet-side record for a
// 2-of-2 MuSig2 agent account where THIS wallet holds one key and acts as
// the automated policy co-signer (daemon half). Distinct from
// MultisigConfig (interactive multisig): this record carries the normalized
// spending policy, the agent + daemon pubkeys, the aggregate address, the
// taproot tweak from address setup, and the embedded spending-window state.
//
// The `window` field is the hot per-authorization usage the
// VaultWindowStore reads/writes (kept on the same record so there is one
// collection to migrate, not two). Everything else changes rarely.
//
// The policy shape matches what the SDK policy evaluator consumes
// (allowedActions / allowedDestinations / maxPerAction / maxPerWindow /
// confirmAbove); it is stored as plain data and handed to sdk.coSigner.CoSigner.

import {
    check,
    checkEach,
    isArray,
    isBoolean,
    isInteger,
    isIsoTimestamp,
    isNonEmptyString,
    isNumber,
    isPlainObject,
    isString,
    result,
} from './validate.js';
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 1;

const HEX_RE = /^[0-9a-f]*$/;
const isHex = (v) => isString(v) && HEX_RE.test(v) && v.length % 2 === 0 && v.length > 0;
const isNullableHex = (v) => v === null || isHex(v);

// A spending-window entry, as produced by VaultWindowStore.record().
function isWindowEntry(e) {
    if (!isPlainObject(e)) return false;
    if (!isNumber(e.t)) return false;
    // action/tick/amount/txid are optional and free-form; only `t` is required.
    return true;
}

// The embedded window state, or null when the account has no maxPerWindow cap.
function isWindowState(w) {
    if (w === null || w === undefined) return true;
    if (!isPlainObject(w)) return false;
    if (!isInteger(w.version)) return false;
    if (!isArray(w.entries)) return false;
    return w.entries.every(isWindowEntry);
}

// The normalized spending policy. allowedActions is the only hard
// requirement (the SDK CoSigner refuses to construct without it); the cap
// tables are validated structurally (plain objects) and interpreted by the
// SDK policy evaluator.
function validatePolicy(errors, policy) {
    if (!check(errors, 'policy', isPlainObject(policy), 'must be an object')) return;
    check(
        errors,
        'policy.allowedActions',
        isArray(policy.allowedActions) && policy.allowedActions.length > 0 && policy.allowedActions.every(isNonEmptyString),
        'must be a non-empty array of action names',
    );
    check(
        errors,
        'policy.allowedDestinations',
        policy.allowedDestinations === null
            || policy.allowedDestinations === undefined
            || (isArray(policy.allowedDestinations) && policy.allowedDestinations.every(isString)),
        'must be null or an array of strings',
    );
    check(
        errors,
        'policy.maxPerAction',
        policy.maxPerAction === null || policy.maxPerAction === undefined || isPlainObject(policy.maxPerAction),
        'must be null or an object',
    );
    if (policy.maxPerWindow !== null && policy.maxPerWindow !== undefined) {
        check(errors, 'policy.maxPerWindow', isPlainObject(policy.maxPerWindow), 'must be null or an object');
        if (isPlainObject(policy.maxPerWindow)) {
            check(
                errors,
                'policy.maxPerWindow.hours',
                isNumber(policy.maxPerWindow.hours) && policy.maxPerWindow.hours > 0,
                'must be a positive number',
            );
        }
    }
    check(
        errors,
        'policy.confirmAbove',
        policy.confirmAbove === null || policy.confirmAbove === undefined || isPlainObject(policy.confirmAbove),
        'must be null or an object',
    );
}

function isAllowedOutput(o) {
    if (!isPlainObject(o)) return false;
    if (!isNonEmptyString(o.address) && !isNonEmptyString(o.script)) return false;
    if (o.maxValue !== undefined && o.maxValue !== null && !(isNumber(o.maxValue) && o.maxValue >= 0)) return false;
    return true;
}

/**
 * @typedef {Object} CoSignerAccountPolicy
 * @property {string[]} allowedActions                  uppercase action names (required)
 * @property {string[]|null} [allowedDestinations]
 * @property {Object|null} [maxPerAction]               { ACTION: { TICK|'*': capString } }
 * @property {{ hours: number, maxActions?: number, perTick?: Object }|null} [maxPerWindow]
 * @property {{ perTick: Object }|null} [confirmAbove]
 */

/**
 * @typedef {Object} CoSignerAccount
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} name
 * @property {string} aggregateAddress                  the funded 2-of-2 P2TR address
 * @property {string} agentPubkey                       hex; the live signer (agent)
 * @property {string} daemonPubkey                      hex; this wallet's key in the group
 * @property {string} daemonDerivationPath              BIP32 path to derive the daemon key
 * @property {string[]} publicKeyOrder                  full signer set incl. ours, in agreed order
 * @property {string|null} tweak                        LEGACY, always null on new records: a supplied
 *           taproot tweak is an unverifiable commitment to an arbitrary script tree (G3). A record
 *           still carrying one is refused at sign time.
 * @property {string|null} recoveryPublicKey            hex; 2-of-3 only. The SDK derives the tap tree
 *           (and its own tweak) from [agent, daemon, recovery], so nothing opaque is ever trusted.
 * @property {CoSignerAccountPolicy} policy
 * @property {Array<{ address?: string, script?: string, maxValue?: number }>} allowedOutputs
 * @property {{ version: number, entries: object[] }|null} window  embedded spending-window state
 * @property {boolean} enabled                          off => the daemon refuses all requests for this account
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @param {object} input
 * @returns {CoSignerAccount}
 */
export function createCoSignerAccount(input) {
    if (!input || typeof input !== 'object') {
        throw new Error('createCoSignerAccount: input is required');
    }
    if (!isNonEmptyString(input.walletId)) throw new Error('createCoSignerAccount: walletId is required');
    if (!isNonEmptyString(input.chainId)) throw new Error('createCoSignerAccount: chainId is required');
    if (!isHex(String(input.agentPubkey || '').toLowerCase())) {
        throw new Error('createCoSignerAccount: agentPubkey must be hex');
    }
    if (!isHex(String(input.daemonPubkey || '').toLowerCase())) {
        throw new Error('createCoSignerAccount: daemonPubkey must be hex');
    }
    if (!isNonEmptyString(input.daemonDerivationPath)) {
        throw new Error('createCoSignerAccount: daemonDerivationPath is required');
    }
    if (!isNonEmptyString(input.aggregateAddress)) {
        throw new Error('createCoSignerAccount: aggregateAddress is required');
    }
    if (!isArray(input.publicKeyOrder) || input.publicKeyOrder.length < 2) {
        throw new Error('createCoSignerAccount: publicKeyOrder must list the full signer set (>= 2)');
    }
    if (!input.policy || !isArray(input.policy.allowedActions) || input.policy.allowedActions.length === 0) {
        throw new Error('createCoSignerAccount: policy.allowedActions is required');
    }
    // A raw taproot tweak is an opaque 32-byte commitment to a script tree
    // nobody downstream can inspect, so whoever supplies it CHOOSES the tree: a
    // tweak computed over a tree holding `<agentPubkey> OP_CHECKSIG` derives
    // exactly the funded address and then lets the agent spend the account
    // alone, with no daemon, no policy and no window (G3). Name the recovery
    // PUBLIC KEY instead and let the SDK derive the tree.
    if (input.tweak) {
        throw new Error('createCoSignerAccount: a raw taproot tweak is not accepted (it is an ' +
            'unverifiable commitment to an arbitrary script tree). Pass recoveryPublicKey for a ' +
            '2-of-3 account; a plain 2-of-2 needs no tweak.');
    }
    if (input.recoveryPublicKey && !isHex(String(input.recoveryPublicKey).toLowerCase())) {
        throw new Error('createCoSignerAccount: recoveryPublicKey must be hex');
    }

    const now = new Date().toISOString();
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        walletId: input.walletId,
        chainId: input.chainId,
        name: isNonEmptyString(input.name) ? input.name : 'Agent account',
        aggregateAddress: input.aggregateAddress,
        agentPubkey: String(input.agentPubkey).toLowerCase(),
        daemonPubkey: String(input.daemonPubkey).toLowerCase(),
        daemonDerivationPath: input.daemonDerivationPath,
        publicKeyOrder: input.publicKeyOrder.map((p) => String(p).toLowerCase()),
        // Retained (always null on new records) so a legacy record carrying one
        // still validates and can be recognized and refused at sign time.
        tweak: null,
        recoveryPublicKey: input.recoveryPublicKey ? String(input.recoveryPublicKey).toLowerCase() : null,
        policy: normalizeStoredPolicy(input.policy),
        allowedOutputs: isArray(input.allowedOutputs) ? input.allowedOutputs : [],
        window: null,
        enabled: input.enabled !== false,
        createdAt: now,
        updatedAt: now,
    };
}

// Store the policy in the shape the SDK evaluator consumes (uppercase action
// names; arrays not Sets, since the record is serialized to the vault blob).
export function normalizeStoredPolicy(policy) {
    return {
        allowedActions: policy.allowedActions.map((a) => String(a).toUpperCase()),
        allowedDestinations: policy.allowedDestinations == null
            ? null
            : policy.allowedDestinations.map((d) => String(d)),
        maxPerAction: policy.maxPerAction ?? null,
        maxPerWindow: policy.maxPerWindow ?? null,
        confirmAbove: policy.confirmAbove ?? null,
    };
}

/**
 * @param {CoSignerAccount} record
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateCoSignerAccount(record) {
    const errors = [];
    if (!check(errors, 'coSignerAccount', isPlainObject(record), 'must be an object')) {
        return result(errors);
    }
    const r = /** @type {CoSignerAccount} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'walletId', isNonEmptyString(r.walletId), 'must be a non-empty string');
    check(errors, 'chainId', isNonEmptyString(r.chainId), 'must be a non-empty string');
    check(errors, 'name', isString(r.name), 'must be a string');
    check(errors, 'aggregateAddress', isNonEmptyString(r.aggregateAddress), 'must be a non-empty string');
    check(errors, 'agentPubkey', isHex(r.agentPubkey), 'must be hex');
    check(errors, 'daemonPubkey', isHex(r.daemonPubkey), 'must be hex');
    check(errors, 'daemonDerivationPath', isNonEmptyString(r.daemonDerivationPath), 'must be a non-empty string');
    check(
        errors,
        'publicKeyOrder',
        isArray(r.publicKeyOrder) && r.publicKeyOrder.length >= 2 && r.publicKeyOrder.every(isHex),
        'must be an array of >= 2 hex pubkeys',
    );
    // Legacy records may still carry a tweak, so this stays permissive and the
    // refusal happens at sign time (passiveCoSignForAccount); a validation
    // failure here would make such a record unreadable rather than unusable.
    check(errors, 'tweak', isNullableHex(r.tweak), 'must be null or hex');
    check(errors, 'recoveryPublicKey', isNullableHex(r.recoveryPublicKey), 'must be null or hex');
    validatePolicy(errors, r.policy);
    checkEach(errors, 'allowedOutputs', r.allowedOutputs, isAllowedOutput, 'malformed');
    check(errors, 'window', isWindowState(r.window), 'must be null or { version, entries[] }');
    check(errors, 'enabled', isBoolean(r.enabled), 'must be a boolean');
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    check(errors, 'updatedAt', isIsoTimestamp(r.updatedAt), 'must be an ISO timestamp');
    return result(errors);
}
