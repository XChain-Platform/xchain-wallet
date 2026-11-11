// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ripemd160 } from '@noble/hashes/legacy';
import { sha256 } from '@noble/hashes/sha2';
import { base58check } from '@scure/base';
import { describe, expect, it } from 'vitest';
import {
    assembleMultisigTx,
    buildUnsignedMultisigSpend,
    decodeMultisigSpend,
    InsufficientMultisigSignaturesError,
    multisigSighash,
} from '../../../packages/core/src/flows/multisigSpend.js';
import { assertTxSignaturesVerify } from '../../../packages/core/src/signers/verifyTxSignatures.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const bitcoin = require('bitcoinjs-lib');
const sdk = new XChainSDK({ network: 'bitcoin-testnet' });
const check = base58check(sha256);
const secrets = ['11', '22', '33'].map((byte) => new Uint8Array(32).fill(Number.parseInt(byte, 16)));
const keys = secrets.map((secret) => {
    const publicKey = secp256k1.getPublicKey(secret, true);
    return {
        privateKey: secret,
        publicKeyHex: Buffer.from(publicKey).toString('hex'),
        wif: check.encode(Uint8Array.from([0xef, ...secret, 0x01])),
    };
});
const template = `multi:2:${keys.map((key) => key.publicKeyHex).join(':')}`;
const destinationScript = `76a914${'44'.repeat(20)}88ac`;

function fixture(scheme, outputs = [{ scriptPubKeyHex: destinationScript, value: 90000n }]) {
    const derived = sdk.deriveMultisigAddress({ scheme, scriptTemplate: template });
    const script = derived.witnessScript || derived.redeemScript;
    const digest = scheme === 'p2wsh-multisig'
        ? Buffer.from(sha256(Buffer.from(script, 'hex'))).toString('hex')
        : Buffer.from(ripemd160(sha256(Buffer.from(script, 'hex')))).toString('hex');
    const scriptPubKeyHex = scheme === 'p2wsh-multisig' ? `0020${digest}` : `a914${digest}87`;
    const built = buildUnsignedMultisigSpend({
        scheme,
        script,
        utxo: { txid: 'aa'.repeat(32), vout: 3, value: 100000n, scriptPubKeyHex },
        outputs,
    });
    return { ...built, scheme, script, scriptPubKeyHex };
}

function directSign(f) {
    const msgHash = multisigSighash({
        scheme: f.scheme, script: f.script, unsignedTxHex: f.unsignedTxHex, amount: 100000n,
    });
    const signatures = keys.slice(0, 2).map((key) => ({
        pubkey: key.publicKeyHex,
        sig: Buffer.from(sdk.wallet.signEcdsa(Buffer.from(msgHash, 'hex'), key.privateKey)).toString('hex'),
    }));
    return { msgHash, signatures };
}

describe.each(['p2wsh-multisig', 'p2sh-multisig'])('%s spend', (scheme) => {
    it('builds a parseable PSBT and assembles a verified transaction', () => {
        const f = fixture(scheme);
        const psbt = bitcoin.Psbt.fromHex(f.psbtHex, { network: sdk.wallet.getBitcoinNetwork() });
        expect(psbt.data.globalMap.unsignedTx.toBuffer().toString('hex')).toBe(f.unsignedTxHex);
        const decoded = decodeMultisigSpend(f.psbtHex);
        expect(decoded).toMatchObject({
            script: f.script,
            input: { txid: 'aa'.repeat(32), vout: 3, amount: 100000n },
            outputs: [{ scriptPubKeyHex: destinationScript, value: 90000n }],
        });

        const { signatures } = directSign(f);
        const txHex = assembleMultisigTx({ ...f, signatures });
        expect(() => assertTxSignaturesVerify({
            txHex,
            prevouts: [{
                prevTxHash: 'aa'.repeat(32),
                prevTxIndex: 3,
                scriptPubKeyHex: f.scriptPubKeyHex,
                value: 100000n,
            }],
            signerId: 'test-multisig',
        })).not.toThrow();
    });

    it('changes the sighash when an amount or output is tampered', () => {
        const f = fixture(scheme);
        const original = directSign(f).msgHash;
        const changedOutput = fixture(scheme, [{ scriptPubKeyHex: destinationScript, value: 89999n }]);
        expect(multisigSighash({
            scheme, script: f.script, unsignedTxHex: changedOutput.unsignedTxHex, amount: 100000n,
        })).not.toBe(original);
        if (scheme === 'p2wsh-multisig') {
            expect(multisigSighash({
                scheme, script: f.script, unsignedTxHex: f.unsignedTxHex, amount: 99999n,
            })).not.toBe(original);
        }
    });

    it('refuses fewer than threshold script-key signatures', () => {
        const f = fixture(scheme);
        const { signatures } = directSign(f);
        expect(() => assembleMultisigTx({ ...f, signatures: signatures.slice(0, 1) }))
            .toThrow(InsufficientMultisigSignaturesError);
        expect(() => assembleMultisigTx({
            ...f,
            signatures: [...signatures.slice(0, 1), { ...signatures[1], pubkey: secp256k1.getPublicKey(new Uint8Array(32).fill(9), true) }],
        })).toThrow(InsufficientMultisigSignaturesError);
    });
});

it('matches the installed SDK finalizer byte for byte for P2WSH', () => {
    const f = fixture('p2wsh-multisig');
    let signed = sdk.wallet.signMultisigPsbt(f.psbtHex, keys[0].wif).psbtHex;
    signed = sdk.wallet.signMultisigPsbt(signed, keys[1].wif).psbtHex;
    const sdkTx = sdk.wallet.finalizeMultisigPsbt(signed, { maximumFeeRate: 100000 }).txHex;
    const ours = assembleMultisigTx({ ...f, signatures: directSign(f).signatures });
    expect(ours).toBe(sdkTx);
});

