// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which signer holds an account's keys, read from the account's own
// HD-derived address records (an Account has no custody field). A seed
// wallet's account derives from the wallet seed, while an account added
// through a paired device holds that device's independent keys at the same
// index, so deriving there with the seed would put a hot key inside an
// account the user holds on the device.
//
// An account holding both 'hd' and device records, records of two device
// kinds, or records linked to two different devices is a conflict no signer
// owns: a derivation that ignored custody can leave a stray record in either
// direction, so the records alone cannot say which side is the stray one. A
// device record with no signerId (written before addresses were linked to
// signers) names its kind but no device, so any device of that kind is
// accepted for it.

import { addressSourceForSignerKind, isDeviceAddressSource } from '../../schemas/constants.js';
import { getSignerRecord } from '../registerSigner.js';

/**
 * @typedef {{ source: string, signerId: string | null } | { conflict: true }} AccountCustody
 */

/**
 * @param {string} accountId
 * @param {Array<any>} addresses   every stored Address record (other accounts are ignored)
 * @returns {AccountCustody | null} null when the account holds no HD-derived record yet
 */
export function accountCustody(accountId, addresses) {
    const deviceSources = new Set();
    const deviceIds = new Set();
    let hasHd = false;
    for (const a of addresses || []) {
        if (!a || a.accountId !== accountId || typeof a.derivationPath !== 'string') continue;
        if (a.source === 'hd') {
            hasHd = true;
        } else if (isDeviceAddressSource(a.source)) {
            deviceSources.add(a.source);
            if (typeof a.signerId === 'string' && a.signerId.length > 0) deviceIds.add(a.signerId);
        }
    }
    if (deviceSources.size > 1 || deviceIds.size > 1) return { conflict: true };
    if (deviceSources.size === 1 && hasHd) return { conflict: true };
    if (deviceSources.size === 1) {
        const [source] = deviceSources;
        const [signerId = null] = deviceIds;
        return { source, signerId };
    }
    return hasHd ? { source: 'hd', signerId: null } : null;
}

/**
 * Does `signer` hold the keys of an account with this custody? An account
 * with no derived record yet carries no evidence and accepts any signer.
 *
 * @param {{ id?: string, kind?: string } | null | undefined} signer
 * @param {AccountCustody | null} custody
 * @returns {boolean}
 */
export function signerOwnsCustody(signer, custody) {
    if (custody === null) return true;
    if ('conflict' in custody) return false;
    let source;
    try {
        source = addressSourceForSignerKind(signer?.kind);
    } catch {
        return false;
    }
    if (source !== custody.source) return false;
    if (!isDeviceAddressSource(source) || custody.signerId === null) return true;
    return signer?.id === custody.signerId;
}

/**
 * Custody of the account a derive request targets, resolved the way the
 * receive and dispenser flows resolve it (accountId, else accountIndex,
 * else index 0). Undefined when the request or vault cannot name one, so
 * the flow reports the missing account itself.
 *
 * @param {any} vault
 * @param {any} req
 * @returns {Promise<AccountCustody | null | undefined>}
 */
async function requestAccountCustody(vault, req) {
    const walletId = req?.walletId;
    if (typeof walletId !== 'string' || walletId.length === 0) return undefined;
    if (typeof vault?.accounts?.findBy !== 'function' || typeof vault?.addresses?.list !== 'function') {
        return undefined;
    }
    const accounts = await vault.accounts.findBy('walletId', walletId);
    const accountIndex = req?.accountIndex === undefined ? 0 : req.accountIndex;
    const account = typeof req?.accountId === 'string' && req.accountId.length > 0
        ? accounts.find((a) => a.id === req.accountId)
        : accounts.find((a) => a.index === accountIndex);
    if (!account) return undefined;
    return accountCustody(account.id, await vault.addresses.list());
}

/**
 * The signerId a derive request for one account should use, or null for the
 * wallet seed. A device account linked to one device uses that device, and a
 * request's own signerId may only repeat it. A seed account uses the seed and
 * refuses a request naming a device. An unlinked device account has no device
 * to pick, so it needs a request naming a paired device of its kind; a
 * conflicting account is refused outright. Each refusal stops the seed from
 * deriving a hot key into an account whose keys live elsewhere.
 *
 * @param {any} vault
 * @param {any} req          { walletId, accountId?, accountIndex?, signerId? }
 * @param {string} route     message type named in the refusal
 * @returns {Promise<string | null>}
 */
export async function accountDeviceSignerId(vault, req, route) {
    const requested = typeof req?.signerId === 'string' && req.signerId.length > 0 ? req.signerId : null;
    const custody = await requestAccountCustody(vault, req);
    if (!custody) return requested;
    if ('conflict' in custody) {
        throw new Error(`${route}: this account holds addresses from more than one signer, so no new address is added to it`);
    }
    if (custody.source === 'hd') {
        if (requested !== null) throw new Error(`${route}: this account is held by the wallet seed, not a device`);
        return null;
    }
    if (custody.signerId !== null) {
        if (requested !== null && requested !== custody.signerId) {
            throw new Error(`${route}: the request names a different device than the one this account is held on`);
        }
        return custody.signerId;
    }
    if (requested === null) {
        throw new Error(`${route}: this account is held on a ${custody.source} device that none of its addresses names, so it cannot be picked for a new address`);
    }
    const record = await getSignerRecord(vault, requested);
    if (record && !signerOwnsCustody({ id: record.id, kind: record.kind }, custody)) {
        throw new Error(`${route}: the request names a different kind of device than this account is held on`);
    }
    return requested;
}
