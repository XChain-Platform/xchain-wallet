// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    addressSourceForSignerKind,
    isDeviceAddressSource,
} from '../../schemas/constants.js';

export class SignerCustodyMismatchError extends Error {
    constructor(accountId) {
        super(`The signer does not own account "${accountId}".`);
        this.name = 'SignerCustodyMismatchError';
        this.accountId = accountId;
    }
}

/**
 * Does the signer in hand own the key material behind the spending address?
 * The seed signer the host pools cannot derive a hardware account's
 * independent keys (walletAddressDiscovery guards discovery the same way), so
 * deriving change with it would move device-custody value to a hot key. A
 * device record without a signer id cannot be tied to a device and fails the
 * check.
 */
export function signerOwnsSource(signer, sourceRecord) {
    let source;
    try {
        source = addressSourceForSignerKind(signer.kind);
    } catch {
        return false;
    }
    if (source !== sourceRecord.source) return false;
    if (!isDeviceAddressSource(source)) return true;
    return typeof sourceRecord.signerId === 'string' && signer.id === sourceRecord.signerId;
}

/**
 * Who holds the keys behind an account's HD-derived addresses, or null when
 * the account has none yet. Device evidence wins over seed evidence, so an
 * account already mixed by a seed derivation stays with its device. Only a
 * linked signerId names a particular device: migrated records carry
 * `signerId: null` and say only that some device owns the account.
 *
 * @returns {{ device: boolean, signerIds: string[] } | null}
 */
export function accountCustody(accountId, addresses) {
    let hasSeed = false;
    let hasDevice = false;
    const signerIds = new Set();
    for (const address of addresses || []) {
        if (address.accountId !== accountId) continue;
        if (address.source === 'hd') {
            hasSeed = true;
            continue;
        }
        if (!isDeviceAddressSource(address.source)) continue;
        hasDevice = true;
        if (typeof address.signerId === 'string' && address.signerId.length > 0) {
            signerIds.add(address.signerId);
        }
    }
    if (hasDevice) return { device: true, signerIds: [...signerIds] };
    return hasSeed ? { device: false, signerIds: [] } : null;
}

/**
 * May this signer add an address to an account with this custody? The seed
 * signer never derives into a device account and a device never derives into
 * a seed account. Within a device account, a linked device id must match;
 * two different linked devices leave no owner, so every signer is refused.
 */
export function signerOwnsAccount(signer, custody) {
    if (!custody) return true;
    let source;
    try {
        source = addressSourceForSignerKind(signer?.kind);
    } catch {
        return false;
    }
    if (!custody.device) return source === 'hd';
    if (!isDeviceAddressSource(source)) return false;
    if (custody.signerIds.length === 0) return true;
    return custody.signerIds.length === 1 && signer.id === custody.signerIds[0];
}

export function assertSignerOwnsAccount(signer, accountId, addresses) {
    if (!signerOwnsAccount(signer, accountCustody(accountId, addresses))) {
        throw new SignerCustodyMismatchError(accountId);
    }
}
