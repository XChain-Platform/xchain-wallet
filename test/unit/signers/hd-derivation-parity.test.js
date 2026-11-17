// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: cross-signer HD derivation parity. The chain descriptors are the
// software wallet's derivation anchor: SLIP-44 coin-type stays at the MAINNET
// slot on every network (testnet/regtest included) so software-signer,
// backend, and descriptor derivations all agree. The hardware signers keep
// their own coin-type maps, so this suite pins two contracts:
//   1. On every hardware-supported MAINNET, the hardware-formatted path is
//      byte-identical to the descriptor's derivationPathFor expansion.
//   2. On every hardware-supported TEST network, the device derives at its own
//      native test coin type 1' (operator ruling 2026-11-15): the descriptor's
//      path with only the coin-type segment replaced. Trezor's test coins and
//      Ledger's Bitcoin Test app both carry slip44 1, so neither vendor needs
//      an unsafe-path flag or a relaxed device setting.
// Address-level checks against each vendor's encoding live in
// hw-test-networks.test.js.

import { describe, it, expect, vi } from 'vitest';
import {
    LedgerSigner,
    LEDGER_APP_NAME_FOR_CHAIN,
    coinTypeFor as ledgerCoinTypeFor,
} from '../../../packages/signers-ledger/src/LedgerSigner.js';
import {
    TrezorSigner,
    coinTypeFor as trezorCoinTypeFor,
} from '../../../packages/signers-trezor/src/TrezorSigner.js';
import { CHAIN_ID_TO_TREZOR_COIN } from '../../../packages/signers-trezor/src/trezorFormat.js';
import { defaultRegistry, FAMILY_MAINNET_COIN_TYPE_SLOT } from '../../../packages/core/src/registry/index.js';

/** GET_APP_AND_VERSION answer bytes for an app name and version. */
function appInfoBytes(name, version = '2.2.1') {
    const enc = (s) => [...new TextEncoder().encode(s)];
    return Uint8Array.from([1, name.length, ...enc(name), version.length, ...enc(version), 1, 0, 0x90, 0x00]);
}

function makeLedger(appName = 'Bitcoin') {
    const testApp = appName === 'Bitcoin Test';
    return new LedgerSigner({
        id: 'ledger-parity-test',
        displayName: 'Ledger (nanoX)',
        model: 'nanoX',
        deviceIdentifier: 'abcdef01',
        app: {
            getWalletPublicKey: vi.fn().mockResolvedValue({
                publicKey: '02' + 'a'.repeat(64),
                bitcoinAddress: testApp ? 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx' : 'bc1qmock',
                chainCode: 'c'.repeat(64),
            }),
        },
        // App name/version comes off the transport, not the app client
        // (packages/signers-ledger/src/appInfo.js).
        transport: { send: vi.fn().mockResolvedValue(appInfoBytes(appName)) },
    });
}

function makeTrezor() {
    return new TrezorSigner({
        id: 'trezor-parity-test',
        displayName: 'Trezor (T2T1)',
        model: 'T2T1',
        deviceIdentifier: 'DEVICE_ID_MOCK',
        connect: {
            getAddress: vi.fn().mockResolvedValue({ success: true, payload: { address: 'bc1qmock' } }),
            getPublicKey: vi.fn().mockResolvedValue({
                success: true,
                payload: { publicKey: '02' + 'a'.repeat(64), chainCode: 'c'.repeat(64), fingerprint: '12345678' },
            }),
        },
    });
}

const TUPLE = { accountIndex: 1, change: 0, startIndex: 5, count: 1 };

// The address type each chain is exercised at on hardware. LTC/DOGE use the
// legacy p2pkh purpose on hardware, which is why this map is NOT derived from
// the descriptors' defaultAddressType: litecoin declares p2wpkh there while
// hardware derives it at the legacy 44' purpose, so a descriptor-derived type
// would fail for the wrong reason.
const HARDWARE_ADDRESS_TYPE = {
    'bitcoin-mainnet': 'p2wpkh',
    'bitcoin-testnet': 'p2wpkh',
    'bitcoin-regtest': 'p2wpkh',
    'litecoin-mainnet': 'p2pkh',
    'litecoin-testnet': 'p2pkh',
    'dogecoin-mainnet': 'p2pkh',
};

// The CHAINS are derived per vendor, not hand-listed and not intersected:
// each signer's own support map. Hand-listing them is the silent no-op this
// suite exists to prevent, and an intersection would give a network only one
// vendor supports (Trezor's Litecoin testnet) zero cases. Derived, an addition
// either gains cases or reddens the completeness check below by name.
const LEDGER_CHAIN_IDS = Object.keys(LEDGER_APP_NAME_FOR_CHAIN);
const TREZOR_CHAIN_IDS = Object.keys(CHAIN_ID_TO_TREZOR_COIN);
const HARDWARE_CHAIN_IDS = [...new Set([...LEDGER_CHAIN_IDS, ...TREZOR_CHAIN_IDS])];
const isMainnet = (chainId) => chainId.endsWith('-mainnet');

const supportedFor = (chainIds) => chainIds
    .filter((chainId) => HARDWARE_ADDRESS_TYPE[chainId])
    .map((chainId) => [chainId, HARDWARE_ADDRESS_TYPE[chainId]]);
const LEDGER_SUPPORTED = supportedFor(LEDGER_CHAIN_IDS);
const TREZOR_SUPPORTED = supportedFor(TREZOR_CHAIN_IDS);

/** The descriptor's path with its coin-type segment set to the native test 1'. */
function nativeTestPath(chainId, addressType, { accountIndex, change, startIndex }) {
    const parts = defaultRegistry().derivationPathFor(chainId, addressType, accountIndex, change, startIndex).split('/');
    parts[2] = "1'";
    return parts.join('/');
}

describe('HD derivation parity: hardware signers vs the descriptor anchor', () => {
    it('descriptor anchor pins bitcoin-testnet at the mainnet coin-type 0\' (the software contract)', () => {
        expect(defaultRegistry().derivationPathFor('bitcoin-testnet', 'p2wpkh', 0, 0, 0))
            .toBe("m/84'/0'/0'/0/0");
    });

    // The point of deriving the chain set: an addition to either signer's
    // support map must fail HERE, by name, rather than quietly producing no
    // parity cases at all.
    it('every hardware-supported chain has an address type and a registered slot', () => {
        expect(HARDWARE_CHAIN_IDS.length).toBeGreaterThan(0);
        for (const chainId of HARDWARE_CHAIN_IDS) {
            expect(
                HARDWARE_ADDRESS_TYPE[chainId],
                `hardware-supported "${chainId}" has no HARDWARE_ADDRESS_TYPE entry, so it emits no parity case`,
            ).toBeTruthy();
            expect(
                FAMILY_MAINNET_COIN_TYPE_SLOT[chainId.split('-')[0]],
                `hardware-supported "${chainId}" has no FAMILY_MAINNET_COIN_TYPE_SLOT entry`,
            ).toBeTruthy();
        }
    });

    it('both vendors cover test networks, so the native-path cases below are not empty', () => {
        expect(LEDGER_CHAIN_IDS.filter((id) => !isMainnet(id)).sort()).toEqual(['bitcoin-regtest', 'bitcoin-testnet']);
        expect(TREZOR_CHAIN_IDS.filter((id) => !isMainnet(id)).sort())
            .toEqual(['bitcoin-regtest', 'bitcoin-testnet', 'litecoin-testnet']);
    });

    // Both signers READ the registry slot for mainnet rather than copying it,
    // so this asserts the lookup resolves rather than that three literals agree.
    for (const chainId of LEDGER_CHAIN_IDS) {
        const want = isMainnet(chainId) ? FAMILY_MAINNET_COIN_TYPE_SLOT[chainId.split('-')[0]] : "1'";
        it(`LedgerSigner resolves ${chainId} to coin type ${want}`, () => {
            expect(ledgerCoinTypeFor(chainId)).toBe(want);
        });
    }

    for (const chainId of TREZOR_CHAIN_IDS) {
        const want = isMainnet(chainId) ? FAMILY_MAINNET_COIN_TYPE_SLOT[chainId.split('-')[0]] : "1'";
        it(`TrezorSigner resolves ${chainId} to coin type ${want}`, () => {
            expect(trezorCoinTypeFor(CHAIN_ID_TO_TREZOR_COIN[chainId])).toBe(want);
        });
    }

    for (const [chainId, addressType] of LEDGER_SUPPORTED) {
        if (isMainnet(chainId)) {
            it(`LedgerSigner derives ${chainId} at the exact descriptor path`, async () => {
                const expected = defaultRegistry().derivationPathFor(
                    chainId, addressType, TUPLE.accountIndex, TUPLE.change, TUPLE.startIndex);
                expect(expected).toBeTruthy();
                const rows = await makeLedger(LEDGER_APP_NAME_FOR_CHAIN[chainId]).getAddresses({ chainId, addressType, ...TUPLE });
                expect(rows[0].path).toBe(expected);
            });
        } else {
            it(`LedgerSigner derives ${chainId} at the native 1' path in the Bitcoin Test app`, async () => {
                const rows = await makeLedger('Bitcoin Test').getAddresses({ chainId, addressType, ...TUPLE });
                expect(rows[0].path).toBe(nativeTestPath(chainId, addressType, TUPLE));
            });
        }
    }

    for (const [chainId, addressType] of TREZOR_SUPPORTED) {
        if (isMainnet(chainId)) {
            it(`TrezorSigner derives ${chainId} at the exact descriptor path`, async () => {
                const expected = defaultRegistry().derivationPathFor(
                    chainId, addressType, TUPLE.accountIndex, TUPLE.change, TUPLE.startIndex);
                expect(expected).toBeTruthy();
                const rows = await makeTrezor().getAddresses({ chainId, addressType, ...TUPLE });
                expect(rows[0].path).toBe(expected);
            });
        } else {
            it(`TrezorSigner derives ${chainId} at the native 1' path`, async () => {
                const rows = await makeTrezor().getAddresses({ chainId, addressType, ...TUPLE });
                expect(rows[0].path).toBe(nativeTestPath(chainId, addressType, TUPLE));
            });
        }
    }

    it('both vendors derive bitcoin-testnet at m/84\'/1\'/..., never the mainnet 0\'', async () => {
        const [trezorRow] = await makeTrezor().getAddresses({ chainId: 'bitcoin-testnet', addressType: 'p2wpkh', ...TUPLE });
        const [ledgerRow] = await makeLedger('Bitcoin Test').getAddresses({ chainId: 'bitcoin-testnet', addressType: 'p2wpkh', ...TUPLE });
        expect(trezorRow.path).toBe("m/84'/1'/1'/0/5");
        expect(ledgerRow.path).toBe("m/84'/1'/1'/0/5");
    });

    // The descriptor lists p2tr as a first-class bitcoin type at m/86', but
    // neither hardware seam can derive or sign it. Falling through to the
    // segwit-v0 default returns a bc1q address on an 84' path that the caller
    // records as p2tr - a mislabeled record that also collides in
    // receiveAddress's per-type index space, since a later p2wpkh request
    // re-issues that same m/84'/.../0 address under a second label. The same
    // refusal holds on the test networks.
    for (const addressType of ['p2tr', 'p2wsh']) {
        it(`LedgerSigner refuses ${addressType} instead of substituting the 84' default`, async () => {
            await expect(makeLedger().getAddresses({ chainId: 'bitcoin-mainnet', addressType, ...TUPLE }))
                .rejects.toThrow(/can't derive/);
            await expect(makeLedger('Bitcoin Test').getAddresses({ chainId: 'bitcoin-testnet', addressType, ...TUPLE }))
                .rejects.toThrow(/can't derive/);
        });

        it(`TrezorSigner refuses ${addressType} instead of substituting the 84' default`, async () => {
            await expect(makeTrezor().getAddresses({ chainId: 'bitcoin-mainnet', addressType, ...TUPLE }))
                .rejects.toThrow(/can't derive/);
            await expect(makeTrezor().getAddresses({ chainId: 'bitcoin-testnet', addressType, ...TUPLE }))
                .rejects.toThrow(/can't derive/);
        });
    }

    // An OMITTED addressType is not an unsupported one: every caller that
    // relies on the per-chain default (the LTC/DOGE lanes, the smoke suites)
    // must keep deriving byte-identically.
    it('an omitted addressType still takes the per-chain default on both signers', async () => {
        const [ledgerRow] = await makeLedger('Litecoin').getAddresses({ chainId: 'litecoin-mainnet', ...TUPLE });
        const [trezorRow] = await makeTrezor().getAddresses({ chainId: 'litecoin-mainnet', ...TUPLE });
        expect(ledgerRow.path).toBe("m/44'/2'/1'/0/5");
        expect(trezorRow.path).toBe("m/44'/2'/1'/0/5");
    });
});
