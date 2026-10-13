// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The recipient-address validator used to accept ANY string
// containing the substring "devmock", and it ships in the core (non
// dev-gated) bundle. These tests pin the dev-mock escape hatch to the exact
// shape mockDeriveAddress produces, so a pasted string that merely mentions
// the marker is rejected like any other non-address.

import { describe, it, expect } from 'vitest';
import { base58check, bech32, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import {
    isValidAddressForChain,
    isValidAddressAnyNetwork,
    detectAddressCoin,
    detectAddressChain,
    addressValidationError,
} from '../../../../packages/core/src/shared/utils/addressValidation.js';
import { addressTypeHint } from '../../../../packages/core/src/shared/routes/AddAddressModal.jsx';
import {
    MOCK_ADDRESS_PREFIXES,
    isDevMockAddress,
    mockDeriveAddress,
} from '../../../../packages/core/src/sdk/devMockAddresses.js';

// A real regtest P2WPKH address (bech32, 'bcrt' HRP), used as the positive
// control so a broken decode can't make the rejection tests pass vacuously.
const REAL_BCRT = 'bcrt1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5phstwt';
const PUBKEY_HEX = '02a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('isDevMockAddress', () => {
    it('accepts every address mockDeriveAddress actually produces', () => {
        for (const [chainId, byType] of Object.entries(MOCK_ADDRESS_PREFIXES)) {
            for (const type of Object.keys(byType)) {
                const addr = mockDeriveAddress(chainId, type, PUBKEY_HEX);
                expect(isDevMockAddress(addr), `${chainId}/${type} -> ${addr}`).toBe(true);
            }
        }
    });

    it('accepts a mock address with an empty tail', () => {
        expect(isDevMockAddress(mockDeriveAddress('bitcoin-regtest', 'p2wpkh', ''))).toBe(true);
    });

    // Dogecoin is p2pkh-only per its descriptor. A dev stub passing a
    // hardcoded 'p2wpkh', which has no dogecoin row, makes the fallthrough leak
    // the literal 'p2wpkh:<pubkey>' where an address belongs.
    it('derives the chain descriptor default when no type is given', () => {
        const doge = mockDeriveAddress('dogecoin-mainnet', undefined, PUBKEY_HEX);
        expect(doge.startsWith('Ddevmock'), doge).toBe(true);
        expect(doge).not.toContain('p2wpkh');
        expect(isDevMockAddress(doge)).toBe(true);
        expect(mockDeriveAddress('bitcoin-mainnet', undefined, PUBKEY_HEX)
            .startsWith('bc1qdevmock')).toBe(true);
    });

    it('lists no segwit address type for any dogecoin chain', () => {
        for (const [chainId, byType] of Object.entries(MOCK_ADDRESS_PREFIXES)) {
            if (!chainId.startsWith('dogecoin-')) continue;
            expect(Object.keys(byType), chainId).toEqual(['p2pkh']);
        }
    });

    it('rejects arbitrary text that merely contains the marker', () => {
        for (const s of [
            'devmock',
            'not-an-address-devmock',
            'devmock-but-longer',
            'send my devmock coins here',
            'bcrt1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5phstwt devmock',
            'DEVMOCK',
            'xdevmockdeadbeef',
        ]) {
            expect(isDevMockAddress(s), s).toBe(false);
        }
    });

    it('rejects a known prefix carrying a non-hex or over-long tail', () => {
        expect(isDevMockAddress('bcrt1qdevmockzzzz')).toBe(false);
        expect(isDevMockAddress(`bcrt1qdevmock${'a'.repeat(25)}`)).toBe(false);
        expect(isDevMockAddress('bcrt1qdevmockDEADBEEF')).toBe(false);
    });

    it('rejects empty and non-string input', () => {
        for (const v of ['', '   ', null, undefined, 0, {}, []]) {
            expect(isDevMockAddress(v)).toBe(false);
        }
    });
});

describe('isValidAddressForChain', () => {
    it('accepts a real regtest bech32 address on bitcoin-regtest', () => {
        expect(isValidAddressForChain(REAL_BCRT, 'bitcoin', 'regtest')).toBe(true);
    });

    it('accepts a genuine dev-mock address', () => {
        const addr = mockDeriveAddress('bitcoin-regtest', 'p2wpkh', PUBKEY_HEX);
        expect(isValidAddressForChain(addr, 'bitcoin', 'regtest')).toBe(true);
    });

    it('rejects a pasted string that merely contains "devmock"', () => {
        for (const s of ['devmock', 'pay-me-devmock-please', 'devmock@example.com']) {
            expect(isValidAddressForChain(s, 'bitcoin', 'mainnet'), s).toBe(false);
        }
    });

    it('still rejects a right-coin address on the wrong network', () => {
        expect(isValidAddressForChain(REAL_BCRT, 'bitcoin', 'mainnet')).toBe(false);
    });
});

describe('isValidAddressAnyNetwork', () => {
    it('accepts a real address and a genuine dev-mock address', () => {
        expect(isValidAddressAnyNetwork(REAL_BCRT)).toBe(true);
        expect(isValidAddressAnyNetwork(mockDeriveAddress('dogecoin-mainnet', 'p2pkh', PUBKEY_HEX))).toBe(true);
    });

    it('rejects a pasted string that merely contains "devmock"', () => {
        for (const s of ['devmock', 'a devmock b', 'Devmock']) {
            expect(isValidAddressAnyNetwork(s), s).toBe(false);
        }
    });
});

// Legacy addresses built from a version byte plus a fixed 20-byte hash, so
// each case pins exactly the byte the detector must read. A Dogecoin testnet
// P2PKH (0x71) prints with the same leading 'n' as a Bitcoin testnet one
// (0x6f), which is how every Dogecoin testnet contact came to show a
// question mark: the old detector stopped at the first character.
const HASH160 = new Uint8Array(20).fill(7);
function legacy(version) {
    return base58check(sha256).encode(new Uint8Array([version, ...HASH160]));
}

function segwit(hrp) {
    return bech32.encode(hrp, [0, ...bech32.toWords(HASH160)]);
}

function taproot(hrp) {
    const program = new Uint8Array(32).fill(7);
    return bech32m.encode(hrp, [1, ...bech32m.toWords(program)]);
}

const FORMAT_CASES = [
    ['bitcoin', 'mainnet', 'p2pkh', legacy(0x00), '1...'],
    ['bitcoin', 'mainnet', 'p2sh-p2wpkh', legacy(0x05), '3...'],
    ['bitcoin', 'mainnet', 'p2wpkh', segwit('bc'), 'bc1q...'],
    ['bitcoin', 'mainnet', 'p2tr', taproot('bc'), 'bc1p...'],
    ['bitcoin', 'testnet', 'p2pkh', legacy(0x6f), 'm.../n...'],
    ['bitcoin', 'testnet', 'p2sh-p2wpkh', legacy(0xc4), '2...'],
    ['bitcoin', 'testnet', 'p2wpkh', segwit('tb'), 'tb1q...'],
    ['bitcoin', 'testnet', 'p2tr', taproot('tb'), 'tb1p...'],
    ['bitcoin', 'regtest', 'p2pkh', legacy(0x6f), 'm.../n...'],
    ['bitcoin', 'regtest', 'p2sh-p2wpkh', legacy(0xc4), '2...'],
    ['bitcoin', 'regtest', 'p2wpkh', segwit('bcrt'), 'bcrt1q...'],
    ['bitcoin', 'regtest', 'p2tr', taproot('bcrt'), 'bcrt1p...'],
    ['litecoin', 'mainnet', 'p2pkh', legacy(0x30), 'L...'],
    ['litecoin', 'mainnet', 'p2sh-p2wpkh', legacy(0x32), 'M...'],
    ['litecoin', 'mainnet', 'p2wpkh', segwit('ltc'), 'ltc1...'],
    ['litecoin', 'testnet', 'p2pkh', legacy(0x6f), 'm.../n...'],
    ['litecoin', 'testnet', 'p2sh-p2wpkh', legacy(0xc4), '2...'],
    ['litecoin', 'testnet', 'p2wpkh', segwit('tltc'), 'tltc1...'],
    ['litecoin', 'regtest', 'p2pkh', legacy(0x6f), 'm.../n...'],
    ['litecoin', 'regtest', 'p2sh-p2wpkh', legacy(0xc4), '2...'],
    ['litecoin', 'regtest', 'p2wpkh', segwit('rltc'), 'rltc1...'],
    ['dogecoin', 'mainnet', 'p2pkh', legacy(0x1e), 'D...'],
    ['dogecoin', 'testnet', 'p2pkh', legacy(0x71), 'n...'],
    ['dogecoin', 'regtest', 'p2pkh', legacy(0x6f), 'm.../n...'],
];

describe('address formats', () => {
    it.each(FORMAT_CASES)('validates and displays %s %s %s', (coin, network, type, address, hint) => {
        expect(isValidAddressForChain(address, coin, network)).toBe(true);
        expect(addressTypeHint({ coin, networkKind: network }, type)).toBe(hint);
        if (type === 'p2wpkh' || type === 'p2tr') expect(address).toBe(address.toLowerCase());
    });
});

describe('addressValidationError', () => {
    const descriptor = (coin, networkKind) => ({ coin, networkKind });

    it.each([
        ['Bitcoin mainnet on regtest', legacy(0x00), descriptor('bitcoin', 'regtest'), 'This is a Bitcoin mainnet address, not a Bitcoin regtest address.'],
        ['Bitcoin mainnet bech32 on testnet', segwit('bc'), descriptor('bitcoin', 'testnet'), 'This is a Bitcoin mainnet address, not a Bitcoin testnet address.'],
        ['Litecoin mainnet on Bitcoin', legacy(0x30), descriptor('bitcoin', 'mainnet'), 'This is a Litecoin mainnet address, not a Bitcoin mainnet address.'],
        ['Dogecoin testnet on mainnet', legacy(0x71), descriptor('dogecoin', 'mainnet'), 'This is a Dogecoin testnet address, not a Dogecoin mainnet address.'],
        ['shared legacy test/regtest prefix', legacy(0x6f), descriptor('bitcoin', 'mainnet'), 'This address belongs to testnet or regtest, not Bitcoin mainnet.'],
    ])('names the source network for %s', (_name, address, target, message) => {
        expect(addressValidationError(address, target)).toBe(message);
    });

    it.each([
        ['base58 checksum', `${legacy(0x00).slice(0, -1)}3`],
        ['bech32 checksum', `${segwit('bc').slice(0, -1)}p`],
        ['plain text', 'not an address'],
    ])('uses plain typo copy for a bad %s', (_name, address) => {
        expect(addressValidationError(address, descriptor('bitcoin', 'mainnet')))
            .toBe('This address has a typo. Check it and try again.');
    });
});

describe('detectAddressChain', () => {
    it('reads coin and network from a bech32 HRP', () => {
        expect(detectAddressChain(REAL_BCRT)).toEqual({ coin: 'bitcoin', network: 'regtest', candidates: ['bitcoin'] });
    });

    it('reads mainnet coins from their exclusive version bytes', () => {
        expect(detectAddressChain(legacy(0x00))).toMatchObject({ coin: 'bitcoin', network: 'mainnet' });
        expect(detectAddressChain(legacy(0x30))).toMatchObject({ coin: 'litecoin', network: 'mainnet' });
        expect(detectAddressChain(legacy(0x1e))).toMatchObject({ coin: 'dogecoin', network: 'mainnet' });
    });

    it('reads Dogecoin testnet from 0x71 even though it prints as a shared "n"', () => {
        const addr = legacy(0x71);
        expect(addr[0]).toBe('n');
        expect(detectAddressChain(addr)).toEqual({ coin: 'dogecoin', network: 'testnet', candidates: ['dogecoin'] });
    });

    it('leaves the shared 0x6f and 0xc4 bytes undecided but names the candidates', () => {
        const p2pkh = detectAddressChain(legacy(0x6f));
        expect(p2pkh.coin).toBeNull();
        expect(p2pkh.network).toBeNull();
        expect(p2pkh.candidates.sort()).toEqual(['bitcoin', 'dogecoin', 'litecoin']);
        const p2sh = detectAddressChain(legacy(0xc4));
        expect(p2sh.coin).toBeNull();
        expect(p2sh.candidates.sort()).toEqual(['bitcoin', 'dogecoin', 'litecoin']);
    });

    it('returns null for a string that is not an address', () => {
        expect(detectAddressChain('')).toBeNull();
        expect(detectAddressChain('not an address')).toBeNull();
        expect(detectAddressChain(legacy(0x00).slice(0, -1))).toBeNull();
        expect(detectAddressChain('tb1qnotreallyvalid')).toBeNull();
    });

    it('rejects a checksummed legacy payload with the wrong length', () => {
        const longPayload = base58check(sha256).encode(new Uint8Array([
            0x00,
            ...new Uint8Array(21).fill(7),
        ]));

        expect(detectAddressChain(longPayload)).toBeNull();
    });

    it('rejects a checksummed legacy address with an unknown version byte', () => {
        expect(detectAddressChain(legacy(0x42))).toBeNull();
    });

    it('rejects mixed-case bech32 instead of repairing it before checksum validation', () => {
        const mixedCase = `${REAL_BCRT.slice(0, 6).toUpperCase()}${REAL_BCRT.slice(6)}`;
        expect(detectAddressChain(mixedCase)).toBeNull();
        expect(isValidAddressForChain(mixedCase, 'bitcoin', 'regtest')).toBe(false);
    });
});

describe('detectAddressCoin', () => {
    it('keeps the first-character answers for exclusive leaders', () => {
        expect(detectAddressCoin('1BitcoinEaterAddressDontSendf59kuE')).toBe('bitcoin');
        expect(detectAddressCoin('LTCexample')).toBe('litecoin');
        expect(detectAddressCoin('DExampleDogeAddr')).toBe('dogecoin');
        expect(detectAddressCoin('tb1qanything')).toBe('bitcoin');
    });

    it('resolves a Dogecoin testnet address instead of returning null', () => {
        expect(detectAddressCoin(legacy(0x71))).toBe('dogecoin');
    });

    it('still returns null for the genuinely shared testnet bytes', () => {
        expect(detectAddressCoin(legacy(0x6f))).toBeNull();
        expect(detectAddressCoin(legacy(0xc4))).toBeNull();
    });
});
