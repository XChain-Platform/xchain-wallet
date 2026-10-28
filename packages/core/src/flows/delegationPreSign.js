// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Capability DELEGATE checks at signing, against the indexed state of the
// sending address.
//
// The indexer records a DELEGATE that breaks its rules as invalid and keeps
// the fee: a rotate (v0) from an address with no active stake, or to a key a
// stake or a live delegation already holds; a revoke (v2) of a key the
// address no longer holds, or one whose revocation is already recorded. The
// confirm page's dry run answers for the moment it ran and can be signed past,
// and a revocation or a new stake can land while the review is open, so the
// composer reads the state again before signing and refuses with nothing
// signed. When the state cannot be read the action is refused as unverified,
// the same way an order cancel is.

import { indexerWatermark } from './balances.js';
import { readAllPages } from './stakingQueries.js';
import { OFFER_LIFECYCLE_REFUSAL } from './marketExpiry.js';

const UNVERIFIED = 'Could not check this delegation against the network. Try again.';
const KEY_TAKEN = 'This key already signs for a stake. Choose a key no stake or delegation uses.';
const ALREADY_REVOKED = "This key's revocation is already recorded.";

function refusal(message) {
    const err = new Error(message);
    // The name every form's failure copy shows verbatim: the wallet's own sentence about chain state.
    err.name = OFFER_LIFECYCLE_REFUSAL;
    err.code = 'DELEGATION_NOT_ACTIONABLE';
    return err;
}

const keyOf = (row) => String(row?.signing_pubkey ?? row?.SIGNING_PUBKEY ?? '').toLowerCase();
const isValid = (row) => String(row?.status ?? row?.STATUS ?? 'valid').trim().toLowerCase() === 'valid';
function blockOf(row, lower, upper) {
    const value = row?.[lower] ?? row?.[upper];
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
}
// In effect when this action can first be indexed, which is the next block.
function activeAt(row, height) {
    if (!isValid(row)) return false;
    const activation = blockOf(row, 'activation_block', 'ACTIVATION_BLOCK');
    const deactivation = blockOf(row, 'deactivation_block', 'DEACTIVATION_BLOCK');
    if (Number.isNaN(activation) || Number.isNaN(deactivation)) return false;
    if (activation !== null && activation > height + 1) return false;
    return deactivation === null || deactivation > height + 1;
}
// A key stays taken while its delegation is pending or active; a revocation in effect frees it.
function holdsKey(row, height) {
    if (!isValid(row)) return false;
    const deactivation = blockOf(row, 'deactivation_block', 'DEACTIVATION_BLOCK');
    return deactivation === null || Number.isNaN(deactivation) || deactivation > height + 1;
}

async function read(fn) {
    let response;
    try {
        response = await readAllPages(fn);
    } catch {
        throw refusal(UNVERIFIED);
    }
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.data)) return response.data;
    throw refusal(UNVERIFIED);
}

/**
 * Throws a plain refusal when the indexer would record this capability
 * DELEGATE as invalid. Other actions and versions pass through.
 *
 * @param {{ sdkRegistry: any, chainId: string, source: string, actionData: { action: string, params: Record<string, string> } }} args
 */
export async function assertDelegationActionable({ sdkRegistry, chainId, source, actionData }) {
    if (actionData?.action !== 'DELEGATE') return;
    const version = String(actionData.params?.VERSION ?? '');
    if (version !== '0' && version !== '2') return;
    const key = String(version === '0' ? actionData.params.NEW_SIGNING_PUBKEY : actionData.params.SIGNING_PUBKEY).toLowerCase();

    let sdk;
    try { sdk = sdkRegistry?.get?.(chainId); } catch { sdk = null; }
    if (!sdk || typeof sdk.getDelegations !== 'function' || typeof sdk.getStakes !== 'function') throw refusal(UNVERIFIED);

    const { watermark } = await indexerWatermark({ sdkRegistry, chainId });
    const height = Number(watermark);
    if (watermark == null || !Number.isFinite(height)) throw refusal(UNVERIFIED);

    const [stakes, delegations] = await Promise.all([
        read((o) => sdk.getStakes(source, 'address', o)),
        read((o) => sdk.getDelegations(source, 'address', o)),
    ]);

    if (version === '0') {
        if (!stakes.some((row) => activeAt(row, height))) {
            throw refusal('This address has no active stake, so a signing key cannot be delegated from it.');
        }
        if (stakes.some((row) => isValid(row) && keyOf(row) === key)) throw refusal(KEY_TAKEN);
        if (delegations.some((row) => keyOf(row) === key && holdsKey(row, height))) {
            throw refusal('This key is already delegated from this address.');
        }
        if (typeof sdk.getValidators === 'function') {
            const roster = await read((o) => sdk.getValidators(o));
            if (roster.some((row) => isValid(row) && keyOf(row) === key)) throw refusal(KEY_TAKEN);
        }
        return;
    }

    // A key delegated again after an earlier revocation has a fresh row, so
    // only the rows still in effect decide.
    const live = delegations.filter((row) => keyOf(row) === key && activeAt(row, height));
    if (live.some((row) => blockOf(row, 'deactivation_block', 'DEACTIVATION_BLOCK') === null)) return;
    if (live.length > 0) throw refusal(ALREADY_REVOKED);
    if (!stakes.some((row) => keyOf(row) === key && activeAt(row, height))) {
        throw refusal('This address holds no active delegation or stake for this key, so there is nothing to revoke.');
    }
}
