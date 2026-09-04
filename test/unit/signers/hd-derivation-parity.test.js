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
// wallet's derivation anchor: SLIP-44 coin-type stays at the MAINNET slot on
// every network (testnet/regtest included) so software-signer, backend, and
// descriptor derivations all agree. The hardware signers keep their own
// coin-type maps, so this suite pins two contracts:
//   1. For every hardware-supported network, the hardware-formatted path is
//      byte-identical to the descriptor's derivationPathFor expansion.
//   2. bitcoin-testnet is hardware-UNSUPPORTED (Ledger/Trezor firmware forces
//      the generic 1' testnet slot, which the wallet cannot accept without
//      splitting derivations), so both signers throw instead of silently
//      deriving m/84'/1'/... addresses the rest of the wallet cannot see.

import { describe, it, expect, vi } from 'vitest';
import { LedgerSigner } from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

function makeLedger() {
    return new LedgerSigner({
        id: 'ledger-parity-test',
        displayName: 'Ledger (nanoX)',
        model: 'nanoX',
        deviceIdentifier: 'abcdef01',
        app: {
            getWalletPublicKey: vi.fn().mockResolvedValue({
                publicKey: '02' + 'a'.repeat(64),
                bitcoinAddress: 'bc1qmock',
                chainCode: 'c'.repeat(64),
            }),
        },
        // App name/version comes off the transport, not the app client
        // (packages/signers-ledger/src/appInfo.js).
        transport: { send: vi.fn().mockResolvedValue(Uint8Array.from([1, 7, 66, 105, 116, 99, 111, 105, 110, 5, 50, 46, 50, 46, 49, 1, 0, 0x90, 0x00])) },
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

// (chainId, addressType) pairs both hardware signers support. LTC/DOGE use the
// legacy p2pkh purpose on hardware, matching their descriptor templates.
const SUPPORTED = [
    ['bitcoin-mainnet', 'p2wpkh'],
    ['litecoin-mainnet', 'p2pkh'],
    ['dogecoin-mainnet', 'p2pkh'],
];

describe('HD derivation parity: hardware signers vs the descriptor anchor', () => {
    it('descriptor anchor pins bitcoin-testnet at the mainnet coin-type 0\' (the parity contract)', () => {
        expect(defaultRegistry().derivationPathFor('bitcoin-testnet', 'p2wpkh', 0, 0, 0))
            .toBe("m/84'/0'/0'/0/0");
    });

    for (const [chainId, addressType] of SUPPORTED) {
        it(`LedgerSigner derives ${chainId} at the exact descriptor path`, async () => {
            const expected = defaultRegistry().derivationPathFor(
                chainId, addressType, TUPLE.accountIndex, TUPLE.change, TUPLE.startIndex);
            expect(expected).toBeTruthy();
            const rows = await makeLedger().getAddresses({ chainId, addressType, ...TUPLE });
            expect(rows[0].path).toBe(expected);
        });

        it(`TrezorSigner derives ${chainId} at the exact descriptor path`, async () => {
            const expected = defaultRegistry().derivationPathFor(
                chainId, addressType, TUPLE.accountIndex, TUPLE.change, TUPLE.startIndex);
            expect(expected).toBeTruthy();
            const rows = await makeTrezor().getAddresses({ chainId, addressType, ...TUPLE });
            expect(rows[0].path).toBe(expected);
        });
    }

    it('LedgerSigner refuses bitcoin-testnet instead of deriving at the divergent 1\'', async () => {
        await expect(makeLedger().getAddresses({ chainId: 'bitcoin-testnet', addressType: 'p2wpkh', ...TUPLE }))
            .rejects.toThrow(/software wallet/);
    });

    it('TrezorSigner refuses bitcoin-testnet instead of deriving at the divergent 1\'', async () => {
        await expect(makeTrezor().getAddresses({ chainId: 'bitcoin-testnet', addressType: 'p2wpkh', ...TUPLE }))
            .rejects.toThrow(/software wallet/);
    });

    // The descriptor lists p2tr as a first-class bitcoin type at m/86', but
    // neither hardware seam can derive or sign it. Falling through to the
    // segwit-v0 default returns a bc1q address on an 84' path that the caller
    // records as p2tr - a mislabeled record that also collides in
    // receiveAddress's per-type index space, since a later p2wpkh request
    // re-issues that same m/84'/.../0 address under a second label.
    for (const addressType of ['p2tr', 'p2wsh']) {
        it(`LedgerSigner refuses ${addressType} instead of substituting the 84' default`, async () => {
            await expect(makeLedger().getAddresses({ chainId: 'bitcoin-mainnet', addressType, ...TUPLE }))
                .rejects.toThrow(/can't derive/);
        });

        it(`TrezorSigner refuses ${addressType} instead of substituting the 84' default`, async () => {
            await expect(makeTrezor().getAddresses({ chainId: 'bitcoin-mainnet', addressType, ...TUPLE }))
                .rejects.toThrow(/can't derive/);
        });
    }

    // An OMITTED addressType is not an unsupported one: every caller that
    // relies on the per-chain default (the LTC/DOGE lanes, the smoke suites)
    // must keep deriving byte-identically.
    it('an omitted addressType still takes the per-chain default on both signers', async () => {
        const [ledgerRow] = await makeLedger().getAddresses({ chainId: 'litecoin-mainnet', ...TUPLE });
        const [trezorRow] = await makeTrezor().getAddresses({ chainId: 'litecoin-mainnet', ...TUPLE });
        expect(ledgerRow.path).toBe("m/44'/2'/1'/0/5");
        expect(trezorRow.path).toBe("m/44'/2'/1'/0/5");
    });
});
