// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    LOGIN_SIGNATURE_FORMATS,
    buildLoginResult,
    loginSignatureFormat,
} from '../../../../packages/extension/src/bridge/loginResult.js';

function proof(address, addressType = 'p2wpkh') {
    return {
        address,
        chainId: 'bitcoin:0',
        addressType,
        challenge: `challenge:${address}`,
        challengeParts: { address, nonce: `nonce:${address}` },
        signature: `signature:${address}`,
    };
}

describe('loginSignatureFormat', () => {
    it.each([
        ['p2pkh', 'legacy'],
        ['p2sh-p2wpkh', 'legacy'],
        ['p2wpkh', 'legacy'],
        ['p2tr', 'bip322-simple'],
    ])('maps %s to %s', (addressType, expected) => {
        expect(loginSignatureFormat(addressType)).toBe(expected);
    });

    it('exports a frozen mapping', () => {
        expect(LOGIN_SIGNATURE_FORMATS).toEqual({
            p2pkh: 'legacy',
            'p2sh-p2wpkh': 'legacy',
            p2wpkh: 'legacy',
            p2tr: 'bip322-simple',
        });
        expect(Object.isFrozen(LOGIN_SIGNATURE_FORMATS)).toBe(true);
    });

    it('rejects an unknown address type', () => {
        expect(() => loginSignatureFormat('p2ms')).toThrow(TypeError);
    });
});

describe('buildLoginResult', () => {
    it('builds a one-proof result with exact top-level and entry keys', () => {
        const first = proof('bc1q-first');
        const result = buildLoginResult([first]);

        expect(Object.keys(result).sort()).toEqual([
            'address',
            'addresses',
            'chainId',
            'challenge',
            'challengeParts',
            'ok',
            'signature',
            'signatureFormat',
        ]);
        expect(Object.keys(result.addresses[0]).sort()).toEqual([
            'address',
            'addressType',
            'chainId',
            'challenge',
            'signature',
            'signatureFormat',
        ]);
        const { addresses, challengeParts, ok, ...topProof } = result;
        const { addressType, ...firstEntry } = addresses[0];
        expect(ok).toBe(true);
        expect(addressType).toBe(first.addressType);
        expect(challengeParts).toBe(first.challengeParts);
        expect(topProof).toEqual(firstEntry);
    });

    it('preserves five proofs in picker order and assigns each format', () => {
        const proofs = [
            proof('bc1q-one', 'p2wpkh'),
            proof('bc1p-two', 'p2tr'),
            proof('bc1q-three', 'p2wpkh'),
            proof('bc1p-four', 'p2tr'),
            proof('bc1q-five', 'p2wpkh'),
        ];

        const result = buildLoginResult(proofs);

        expect(result.address).toBe('bc1q-one');
        expect(result.addresses.map(({ address }) => address)).toEqual(proofs.map(({ address }) => address));
        expect(result.addresses.map(({ signatureFormat }) => signatureFormat)).toEqual([
            'legacy',
            'bip322-simple',
            'legacy',
            'bip322-simple',
            'legacy',
        ]);
    });

    it('rejects six proofs', () => {
        expect(() => buildLoginResult(Array.from({ length: 6 }, (_, i) => proof(`address-${i}`))))
            .toThrow(TypeError);
    });

    it('rejects an empty proof list', () => {
        expect(() => buildLoginResult([])).toThrow(TypeError);
    });

    it('rejects a non-array proof list', () => {
        expect(() => buildLoginResult(null)).toThrow(TypeError);
    });

    it('rejects a repeated address', () => {
        expect(() => buildLoginResult([proof('duplicate'), proof('duplicate', 'p2tr')]))
            .toThrow(TypeError);
    });

    it('rejects a missing signature', () => {
        const missing = proof('missing-signature');
        delete missing.signature;

        expect(() => buildLoginResult([missing])).toThrow(TypeError);
    });
});
