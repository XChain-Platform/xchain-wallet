// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { LOGIN_PROOF_LIMIT } from './loginAddressSet.js';

export const LOGIN_SIGNATURE_FORMATS = Object.freeze({
    p2pkh: 'legacy',
    'p2sh-p2wpkh': 'legacy',
    p2wpkh: 'legacy',
    p2tr: 'bip322-simple',
});

export function loginSignatureFormat(addressType) {
    if (!Object.hasOwn(LOGIN_SIGNATURE_FORMATS, addressType)) {
        throw new TypeError(`Unsupported login address type: ${String(addressType)}`);
    }
    return LOGIN_SIGNATURE_FORMATS[addressType];
}

export function buildLoginResult(proofs) {
    if (!Array.isArray(proofs)
        || proofs.length < 1
        || proofs.length > LOGIN_PROOF_LIMIT) {
        throw new TypeError(`Login proofs must contain 1 to ${LOGIN_PROOF_LIMIT} entries`);
    }

    const seen = new Set();
    const addresses = proofs.map((proof) => {
        if (!proof || typeof proof !== 'object') {
            throw new TypeError('Each login proof must be an object');
        }

        for (const field of ['address', 'chainId', 'addressType', 'challenge', 'signature']) {
            if (typeof proof[field] !== 'string') {
                throw new TypeError(`Login proof field ${field} must be a string`);
            }
        }
        if (!Object.hasOwn(proof, 'challengeParts')) {
            throw new TypeError('Login proof field challengeParts is required');
        }
        if (seen.has(proof.address)) {
            throw new TypeError(`Login proof address is repeated: ${proof.address}`);
        }
        seen.add(proof.address);

        return {
            address: proof.address,
            chainId: proof.chainId,
            addressType: proof.addressType,
            challenge: proof.challenge,
            signature: proof.signature,
            signatureFormat: loginSignatureFormat(proof.addressType),
        };
    });

    const first = proofs[0];
    return {
        ok: true,
        address: first.address,
        chainId: first.chainId,
        challenge: first.challenge,
        challengeParts: first.challengeParts,
        signature: first.signature,
        signatureFormat: addresses[0].signatureFormat,
        addresses,
    };
}
