// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { base58check, bech32, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { describe, expect, it } from 'vitest';
import { isValidAddressForChain } from '../../../packages/core/src/shared/utils/addressValidation.js';

const HASH160 = new Uint8Array(20).fill(0x2a);
const TAPROOT_PROGRAM = new Uint8Array(32).fill(0x2a);

function legacy(version) {
    return base58check(sha256).encode(new Uint8Array([version, ...HASH160]));
}

function bech32Address(hrp) {
    return bech32.encode(hrp, [0, ...bech32.toWords(HASH160)]);
}

function bech32mAddress(hrp) {
    return bech32m.encode(hrp, [1, ...bech32m.toWords(TAPROOT_PROGRAM)]);
}

function corruptChecksum(address) {
    const replacement = address.endsWith('q') ? 'p' : 'q';
    return `${address.slice(0, -1)}${replacement}`;
}

const CHAINS = [
    {
        coin: 'bitcoin',
        network: 'mainnet',
        forms: {
            legacy: legacy(0x00),
            p2sh: legacy(0x05),
            bech32: bech32Address('bc'),
            bech32m: bech32mAddress('bc'),
        },
        wrongNetwork: legacy(0x6f),
    },
    {
        coin: 'bitcoin',
        network: 'testnet',
        forms: {
            legacy: legacy(0x6f),
            p2sh: legacy(0xc4),
            bech32: bech32Address('tb'),
            bech32m: bech32mAddress('tb'),
        },
        wrongNetwork: legacy(0x00),
    },
    {
        coin: 'bitcoin',
        network: 'regtest',
        forms: {
            legacy: legacy(0x6f),
            p2sh: legacy(0xc4),
            bech32: bech32Address('bcrt'),
            bech32m: bech32mAddress('bcrt'),
        },
        wrongNetwork: legacy(0x00),
    },
    {
        coin: 'litecoin',
        network: 'mainnet',
        forms: {
            legacy: legacy(0x30),
            p2sh: legacy(0x32),
            bech32: bech32Address('ltc'),
        },
        wrongNetwork: legacy(0x6f),
    },
    {
        coin: 'litecoin',
        network: 'testnet',
        forms: {
            legacy: legacy(0x6f),
            p2sh: legacy(0xc4),
            bech32: bech32Address('tltc'),
        },
        wrongNetwork: legacy(0x30),
    },
    {
        coin: 'litecoin',
        network: 'regtest',
        forms: {
            legacy: legacy(0x6f),
            p2sh: legacy(0xc4),
            bech32: bech32Address('rltc'),
        },
        wrongNetwork: legacy(0x30),
    },
    {
        coin: 'dogecoin',
        network: 'mainnet',
        forms: {
            legacy: legacy(0x1e),
            p2sh: legacy(0x16),
        },
        wrongNetwork: legacy(0x71),
    },
    {
        coin: 'dogecoin',
        network: 'testnet',
        forms: {
            legacy: legacy(0x71),
            p2sh: legacy(0xc4),
        },
        wrongNetwork: legacy(0x1e),
    },
    {
        coin: 'dogecoin',
        network: 'regtest',
        forms: {
            legacy: legacy(0x6f),
            p2sh: legacy(0xc4),
        },
        wrongNetwork: legacy(0x1e),
    },
];

const FORM_CASES = CHAINS.flatMap(({ coin, network, forms }) => (
    Object.entries(forms).map(([form, address]) => ({ coin, network, form, address }))
));

const SEGWIT_CASES = FORM_CASES.filter(({ form }) => form === 'bech32' || form === 'bech32m');

describe('per-chain address validation matrix', () => {
    it.each(FORM_CASES)('accepts $coin $network $form', ({ coin, network, address }) => {
        expect(isValidAddressForChain(address, coin, network)).toBe(true);
    });

    it.each(CHAINS)('rejects a $coin $network address from another network', ({
        coin,
        network,
        wrongNetwork,
    }) => {
        expect(isValidAddressForChain(wrongNetwork, coin, network)).toBe(false);
    });

    it.each(FORM_CASES)('rejects $coin $network $form with a bad checksum', ({
        coin,
        network,
        address,
    }) => {
        expect(isValidAddressForChain(corruptChecksum(address), coin, network)).toBe(false);
    });

    it.each(SEGWIT_CASES)('rejects mixed-case $coin $network $form', ({ coin, network, address }) => {
        const mixedCase = `${address[0].toUpperCase()}${address.slice(1)}`;
        expect(isValidAddressForChain(mixedCase, coin, network)).toBe(false);
    });

    it.each(FORM_CASES)('accepts surrounding whitespace on $coin $network $form', ({
        coin,
        network,
        address,
    }) => {
        expect(isValidAddressForChain(` \n\t${address}\r `, coin, network)).toBe(true);
    });
});
