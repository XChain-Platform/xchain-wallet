// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Address type for an imported private key, shared by importSingleWif and
// importWif.
//
// An uncompressed key (a WIF starting 5 on mainnet, 9 on testnet) has one
// standard address: P2PKH over its 65-byte public key. That is where an older
// wallet holding the key received its funds. Segwit outputs commit to a
// compressed public key, so P2WPKH or P2SH-P2WPKH would name an address this
// key does not control, and the SDK refuses to derive one. With no type asked
// for, an uncompressed key lands on P2PKH; an explicit segwit pick is refused
// with copy naming the legacy type.

export const UNCOMPRESSED_KEY_TYPE = 'UNCOMPRESSED_KEY_TYPE';

/**
 * @param {{ addressTypes: string[], defaultAddressType: string }} descriptor
 * @param {string | undefined} addressType  the caller's pick, if any
 * @param {{ compressed?: boolean }} keyInfo  `sdk.wallet.importWIF` result
 * @param {(reason: string, code: string) => Error} makeError  the flow's InvalidWifError
 * @returns {string}
 */
export function importedKeyAddressType(descriptor, addressType, keyInfo, makeError) {
    const uncompressed = keyInfo?.compressed === false;
    if (!uncompressed) return addressType ?? descriptor.defaultAddressType;
    if (addressType !== undefined && addressType !== 'p2pkh') {
        throw makeError(`uncompressed key has no ${addressType} address`, UNCOMPRESSED_KEY_TYPE);
    }
    return 'p2pkh';
}
