// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// updateCoSignerAccount (§22, P4 passive co-signer, management).
//
// Edit a stored CoSignerAccount: rename, enable/disable, or replace the
// policy / allowedOutputs. The cryptographic identity of the account (agent
// + daemon pubkeys, key order, aggregate address, derivation path) is
// immutable: changing any of those produces a different aggregate address,
// which is a NEW account, not an edit. So this flow only accepts the mutable
// fields and re-validates the whole record before persisting.
//
// Disabling (enabled:false) is the soft off-switch: the daemon refuses every
// request for a disabled account and the bridge resolver treats it as
// unknown (see coSignerAccountQueries.findCoSignerAccountByAddress).

import { validateCoSignerAccount, normalizeStoredPolicy } from '../schemas/coSignerAccount.js';

export class CoSignerAccountNotFoundError extends Error {
    constructor(id) {
        super(`co-signer account not found: ${id}`);
        this.name = 'CoSignerAccountNotFoundError';
        this.id = id;
    }
}

/**
 * @typedef {Object} UpdateCoSignerAccountOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} id                                            account id
 * @property {Object} [patch]
 * @property {string} [patch.name]
 * @property {boolean} [patch.enabled]
 * @property {import('../schemas/coSignerAccount.js').CoSignerAccountPolicy} [patch.policy]
 * @property {Array<{ address?: string, script?: string, maxValue?: number }>} [patch.allowedOutputs]
 */

/**
 * @param {UpdateCoSignerAccountOpts} opts
 * @returns {Promise<import('../schemas/coSignerAccount.js').CoSignerAccount>}
 */
export async function updateCoSignerAccount(opts = {}) {
    const { vault, id, patch = {} } = opts;

    if (!vault || !vault.coSignerAccounts) throw new Error('updateCoSignerAccount: vault is required');
    if (typeof id !== 'string' || id.length === 0) throw new Error('updateCoSignerAccount: id is required');

    const existing = await vault.coSignerAccounts.get(id);
    if (!existing) throw new CoSignerAccountNotFoundError(id);

    const next = { ...existing, updatedAt: new Date().toISOString() };

    if (patch.name !== undefined) {
        if (typeof patch.name !== 'string' || patch.name.trim().length === 0) {
            throw new Error('updateCoSignerAccount: name must be a non-empty string');
        }
        next.name = patch.name.trim();
    }

    if (patch.enabled !== undefined) {
        if (typeof patch.enabled !== 'boolean') throw new Error('updateCoSignerAccount: enabled must be a boolean');
        next.enabled = patch.enabled;
    }

    if (patch.policy !== undefined) {
        if (!patch.policy || !Array.isArray(patch.policy.allowedActions) || patch.policy.allowedActions.length === 0) {
            throw new Error('updateCoSignerAccount: policy.allowedActions is required');
        }
        // Normalize through the same path createCoSignerAccount uses so the
        // stored shape (uppercase actions, arrays not Sets) stays identical.
        next.policy = normalizeStoredPolicy(patch.policy);
    }

    if (patch.allowedOutputs !== undefined) {
        if (!Array.isArray(patch.allowedOutputs)) throw new Error('updateCoSignerAccount: allowedOutputs must be an array');
        next.allowedOutputs = patch.allowedOutputs;
    }

    const check = validateCoSignerAccount(next);
    if (!check.ok) {
        throw new Error(`updateCoSignerAccount: invalid record: ${check.errors.join('; ')}`);
    }

    await vault.coSignerAccounts.put(next);
    return next;
}
