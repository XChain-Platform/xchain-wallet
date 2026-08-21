// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The all-or-refuse backstop on the hardware signing lane.
//
// Both vendor converters demand a signingPaths entry for EVERY decomposed
// input and both device signers return a final serialized tx, never a
// partially-signed PSBT, so `signingPaths` on this lane is "the key for each
// input", not the "sign only these" scope SoftwareSigner implements. Without
// the backstop a mixed-input (co-signed) PSBT dies inside the converter with
// `no signingPath for input index N`; the backstop turns that into the
// capability message, ahead of any device work.

import { describe, it, expect, vi } from 'vitest';
import { assertFullInputCoverage, SignerStatusError }
    from '../../../packages/core/src/signers/Signer.js';
import { LedgerSigner } from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';

const PSBT = '70736274ff01' + '00'.repeat(8);
const PATH = "m/84'/0'/0'/0/0";

describe('assertFullInputCoverage', () => {
    it('passes when every input index has an entry, in any order, with duplicates', () => {
        expect(() => assertFullInputCoverage('s', 3, [
            { inputIndex: 2, path: PATH }, { inputIndex: 0, path: PATH }, { inputIndex: 1, path: PATH },
            { inputIndex: 1, path: PATH },
        ])).not.toThrow();
        expect(() => assertFullInputCoverage('s', 0, [])).not.toThrow();
    });

    it('throws a SignerStatusError naming the counts when an input is uncovered', () => {
        let caught;
        try {
            assertFullInputCoverage('s', 3, [{ inputIndex: 0, path: PATH }, { inputIndex: 2, path: PATH }]);
        } catch (err) { caught = err; }
        expect(caught).toBeInstanceOf(SignerStatusError);
        expect(caught.message).toMatch(/cannot partially sign \(this key owns 2 of 3 inputs\)/);
        expect(caught.message).toMatch(/software wallet key/);
    });

    it('an out-of-range or malformed inputIndex does not count as coverage', () => {
        expect(() => assertFullInputCoverage('s', 1, [{ inputIndex: 5, path: PATH }]))
            .toThrow(/owns 0 of 1 inputs/);
        expect(() => assertFullInputCoverage('s', 1, [{ inputIndex: '0', path: PATH }]))
            .toThrow(/owns 0 of 1 inputs/);
        expect(() => assertFullInputCoverage('s', 1, null)).toThrow(/owns 0 of 1 inputs/);
    });
});

// Two inputs decomposed, one signing path: the device must never be asked.
const sdkRegistry = {
    get: () => ({
        wallet: {
            decomposePsbt: () => ({
                inputs: [
                    { scriptType: 'p2wpkh', prevTxHash: 'a'.repeat(64), prevTxIndex: 0, value: 1000, sequence: 0xffffffff },
                    { scriptType: 'p2wpkh', prevTxHash: 'b'.repeat(64), prevTxIndex: 1, value: 1000, sequence: 0xffffffff },
                ],
                outputs: [{ value: 900, scriptPubKeyHex: '0014' + 'c'.repeat(40), address: 'bc1qrecipient' }],
                locktime: 0,
            }),
            txidOf: () => 'txid',
        },
    }),
};

describe('LedgerSigner refuses a partially-covered PSBT before any device work', () => {
    it('throws the capability message, not the converter\'s internal one', async () => {
        const app = { createPaymentTransaction: vi.fn(), splitTransaction: vi.fn() };
        const signer = new LedgerSigner({
            id: 'ledger-test', displayName: 'Ledger', model: 'nanoX', deviceIdentifier: 'abcdef01',
            app, transport: { send: vi.fn() }, sdkRegistry,
        });
        await expect(signer.signPsbt({
            psbtHex: PSBT, chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: PATH }],
        })).rejects.toThrow(/cannot partially sign \(this key owns 1 of 2 inputs\)/);
        expect(app.splitTransaction).not.toHaveBeenCalled();
        expect(app.createPaymentTransaction).not.toHaveBeenCalled();
    });
});

describe('TrezorSigner refuses a partially-covered PSBT before any device work', () => {
    it('throws the capability message, not the converter\'s internal one', async () => {
        const connect = { signTransaction: vi.fn() };
        const signer = new TrezorSigner({
            id: 'trezor-test', displayName: 'Trezor', model: 'T2T1', deviceIdentifier: 'DEVICE_ID_MOCK',
            connect, sdkRegistry,
        });
        await expect(signer.signPsbt({
            psbtHex: PSBT, chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 1, path: PATH }],
        })).rejects.toThrow(/cannot partially sign \(this key owns 1 of 2 inputs\)/);
        expect(connect.signTransaction).not.toHaveBeenCalled();
    });
});
