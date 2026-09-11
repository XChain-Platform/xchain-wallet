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
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import {
    isValidAddressForChain,
    isValidAddressAnyNetwork,
    detectAddressCoin,
    detectAddressChain,
} from '../../../../packages/core/src/shared/utils/addressValidation.js';
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
