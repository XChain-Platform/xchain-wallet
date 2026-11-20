/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A Litecoin hardware account is now native segwit (p2wpkh at m/84'/2'),
// the type the connect flow asks for and records. Both vendors must sign a
// spend from it, and the reply must verify against the approved input. The
// existing network suite signs Litecoin at p2pkh only.

import { describe, it, expect, vi } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import { mnemonicToSeedSync } from '@scure/bip39';
import { derive, hdKeyFromSeed } from '../../../packages/core/src/crypto/hd.js';
import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';
import { pathToAddressN } from '../../../packages/signers-trezor/src/trezorFormat.js';
import { LedgerSigner } from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { decomposedFor, signedReplyFor } from '../../helpers/hwSignedReply.js';
import {
    LEDGER_APPS, SEED_A, appInfoBytes, encodeAddress, seededTrezorConnect,
} from '../../helpers/hwSeedDevice.js';

const ROOT = hdKeyFromSeed(mnemonicToSeedSync(SEED_A));
const PATH = "m/84'/2'/0'/0/0";
const CHANGE_PATH = "m/84'/2'/0'/1/0";

function spend() {
    const key = Buffer.from(derive(ROOT, PATH).privateKey).toString('hex');
    const changeKey = Buffer.from(derive(ROOT, CHANGE_PATH).privateKey).toString('hex');
    const change = decomposedFor({ inputs: [{ scriptType: 'p2wpkh', key: changeKey }] }).inputs[0].scriptPubKeyHex;
    const decomposed = decomposedFor({
        network: 'litecoin-mainnet',
        inputs: [{ scriptType: 'p2wpkh', key, value: 5_000_000 }],
        outputs: [{
            address: encodeAddress(derive(ROOT, CHANGE_PATH).publicKeyHex, 84, LEDGER_APPS.Litecoin),
            scriptPubKeyHex: change,
            scriptType: 'p2wpkh',
            value: 4_900_000,
        }],
    });
    for (const inp of decomposed.inputs) {
        inp.prevTxInfo = { hash: inp.prevTxHash, version: 2, locktime: 0, inputs: [], bin_outputs: [] };
        inp.nonWitnessUtxoHex = 'aa';
    }
    return { decomposed, txHex: signedReplyFor(decomposed, { keys: [key] }) };
}

function registryFor(decomposed) {
    return {
        get: () => ({
            wallet: {
                decomposePsbt: () => decomposed,
                txidOf: (hex) => bitcoin.Transaction.fromHex(hex).getId(),
            },
        }),
    };
}

describe('Litecoin native segwit hardware spends', () => {
    it('Trezor signs a p2wpkh Litecoin input at m/84\'/2\' as SPENDWITNESS and the reply verifies', async () => {
        const { decomposed, txHex } = spend();
        const connect = {
            ...seededTrezorConnect(SEED_A),
            signTransaction: vi.fn(async () => ({ success: true, payload: { serializedTx: txHex } })),
        };
        const signer = new TrezorSigner({
            id: 'trezor-ltc', displayName: 'Trezor', model: 'T3T1', deviceIdentifier: 'dev', connect, sdkRegistry: registryFor(decomposed),
        });
        const out = await signer.signPsbt({ psbtHex: '70736274ff', chainId: 'litecoin-mainnet', signingPaths: [{ inputIndex: 0, path: PATH }] });
        expect(out.txHex).toBe(txHex);
        const sent = connect.signTransaction.mock.calls[0][0];
        expect(sent.coin).toBe('ltc');
        expect(sent.inputs[0].address_n).toEqual(pathToAddressN(PATH));
        expect(sent.inputs[0].script_type).toBe('SPENDWITNESS');
    });

    it('Ledger signs a p2wpkh Litecoin input in the Litecoin app as a segwit payment and the reply verifies', async () => {
        const { decomposed, txHex } = spend();
        const createPaymentTransaction = vi.fn(async () => txHex);
        const getApp = vi.fn(() => ({
            getWalletPublicKey: vi.fn(),
            signMessage: vi.fn(),
            splitTransaction: vi.fn(() => ({ split: true })),
            createPaymentTransaction,
        }));
        const signer = new LedgerSigner({
            id: 'ledger-ltc',
            displayName: 'Ledger',
            model: 'nanoX',
            deviceIdentifier: 'dev',
            getApp,
            transport: { send: vi.fn().mockResolvedValue(appInfoBytes('Litecoin')) },
            sdkRegistry: registryFor(decomposed),
        });
        const out = await signer.signPsbt({ psbtHex: '70736274ff', chainId: 'litecoin-mainnet', signingPaths: [{ inputIndex: 0, path: PATH }] });
        expect(out.txHex).toBe(txHex);
        expect(getApp).toHaveBeenCalledWith('litecoin');
        const payment = createPaymentTransaction.mock.calls[0][0];
        expect(payment.associatedKeysets).toEqual([PATH]);
        expect(payment.segwit).toBe(true);
    });
});
