// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the recipient-address validator used to accept ANY string
// containing the substring "devmock", and it ships in the core (non
// dev-gated) bundle. These tests pin the dev-mock escape hatch to the exact
// shape mockDeriveAddress produces, so a pasted string that merely mentions
// the marker is rejected like any other non-address.

import { describe, it, expect } from 'vitest';
import {
    isValidAddressForChain,
    isValidAddressAnyNetwork,
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
