// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    signMessageOptsFromAddressType,
    signMessageOptsFromPath,
} from '../../../packages/core/src/signers/messageSignOptions.js';

describe('message signing options', () => {
    describe('address type mapping', () => {
        it.each([
            ['p2pkh', {}],
            ['p2sh-p2wpkh', { segwitRedeemScript: true }],
            ['p2wpkh', { segwitNative: true }],
            ['p2tr', { format: 'bip322-simple' }],
        ])('maps %s to the expected options', (addressType, expected) => {
            expect(signMessageOptsFromAddressType(addressType)).toEqual(expected);
        });

        it.each(['unknown', null, '', 7])('refuses unsupported address type %j', (addressType) => {
            expect(() => signMessageOptsFromAddressType(addressType)).toThrow(
                `SoftwareSigner.signMessage: unsupported address type "${addressType}"`,
            );
        });

        it.each(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'])(
            'returns fresh options for %s',
            (addressType) => {
                const first = signMessageOptsFromAddressType(addressType);
                first.changed = true;

                expect(signMessageOptsFromAddressType(addressType)).not.toHaveProperty('changed');
            },
        );
    });

    describe('path mapping', () => {
        it.each([
            ["m/44'/0'/0'/0/0", {}],
            ["m/49'/0'/0'/0/0", { segwitRedeemScript: true }],
            ["m/84'/0'/0'/0/0", { segwitNative: true }],
            ["m/86'/0'/0'/0/0", { format: 'bip322-simple' }],
            ["m/1017'/0'/0'/0/0", {}],
            ['not-a-path', {}],
        ])('maps %s to the expected options', (path, expected) => {
            expect(signMessageOptsFromPath(path)).toEqual(expected);
        });

        it.each([
            "m/44'/0'/0'/0/0",
            "m/49'/0'/0'/0/0",
            "m/84'/0'/0'/0/0",
            "m/86'/0'/0'/0/0",
            "m/1017'/0'/0'/0/0",
        ])('returns fresh options for %s', (path) => {
            const first = signMessageOptsFromPath(path);
            first.changed = true;

            expect(signMessageOptsFromPath(path)).not.toHaveProperty('changed');
        });
    });
});
