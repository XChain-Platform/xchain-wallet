// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { secp256k1 } from '@noble/curves/secp256k1';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeMultisigSpend, multisigSighash } from '../../../packages/core/src/flows/multisigSpend.js';
import {
    NO_SINGLE_COIN_MESSAGE,
    startMultisigSend,
    TAPROOT_UNAVAILABLE_MESSAGE,
} from '../../../packages/core/src/flows/multisigSend.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const bitcoin = require('bitcoinjs-lib');
const realSdk = new XChainSDK({ network: 'bitcoin-testnet' });
const pubkeys = [1, 2, 3].map((byte) => Buffer.from(
    secp256k1.getPublicKey(new Uint8Array(32).fill(byte), true),
).toString('hex'));
const destinationKey = secp256k1.getPublicKey(new Uint8Array(32).fill(9), true);
const destination = realSdk.wallet.deriveAddress(destinationKey, { type: 'p2pkh' });

function config(overrides = {}) {
    return {
        id: 'multisig-1',
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosigners: pubkeys.map((pubkey, index) => ({ pubkey, name: `Signer ${index + 1}` })),
        scriptTemplate: `multi:2:${pubkeys.join(':')}`,
        ...overrides,
    };
}

function harness({ multisig = config(), utxos = [] } = {}) {
    const records = new Map();
    const wallet = { id: 'wallet-1', multisigs: [multisig] };
    const getUTXOs = vi.fn().mockResolvedValue(utxos);
    const sdk = {
        deriveMultisigAddress: realSdk.deriveMultisigAddress.bind(realSdk),
        validateAddress: realSdk.validateAddress.bind(realSdk),
        wallet: { getBitcoinNetwork: realSdk.wallet.getBitcoinNetwork.bind(realSdk.wallet) },
        encoder: { getUTXOs },
    };
    return {
        records,
        wallet,
        getUTXOs,
        opts: {
            vault: {
                wallets: { get: vi.fn(async () => wallet) },
                multisigSigningSessions: { put: vi.fn(async (record) => records.set(record.id, record)) },
            },
            sdkRegistry: { get: vi.fn(() => sdk) },
            walletId: wallet.id,
            chainId: 'bitcoin-testnet',
            multisigConfigId: multisig.id,
            destination,
            amountSats: 50000n,
            feeRate: 2,
        },
    };
}

function sourceScript(multisig = config()) {
    const derived = realSdk.deriveMultisigAddress({
        scheme: multisig.scheme, scriptTemplate: multisig.scriptTemplate,
    });
    return Buffer.from(bitcoin.address.toOutputScript(
        derived.address, realSdk.wallet.getBitcoinNetwork(),
    )).toString('hex');
}

describe('startMultisigSend', () => {
    let scriptPubKeyHex;

    beforeEach(() => {
        scriptPubKeyHex = sourceScript();
    });

    it('picks the smallest covering coin, adds change, and binds the session hash', async () => {
        const h = harness({ utxos: [
            { txid: '11'.repeat(32), vout: 0, value: 200000n, scriptPubKeyHex },
            { txid: '22'.repeat(32), vout: 1, value: 100000n, scriptPubKeyHex },
        ] });
        const session = await startMultisigSend(h.opts);
        const spend = decodeMultisigSpend(session.psbtHex);

        expect(spend.input).toMatchObject({ txid: '22'.repeat(32), vout: 1, amount: 100000n });
        expect(spend.outputs).toHaveLength(2);
        const derived = realSdk.deriveMultisigAddress({
            scheme: h.wallet.multisigs[0].scheme,
            scriptTemplate: h.wallet.multisigs[0].scriptTemplate,
        });
        expect(session.msgHash).toBe(multisigSighash({
            scheme: 'p2wsh-multisig',
            script: derived.witnessScript,
            unsignedTxHex: spend.unsignedTxHex,
            amount: spend.input.amount,
        }));
        expect(spend.input.amount - spend.outputs.reduce((sum, output) => sum + output.value, 0n)).toBe(386n);
        expect(session.actionSummary).toBe(`Send 0.0005 BTC to ${destination}`);
    });

    it('skips a coin locked to another script and fills a missing script with the multisig own', async () => {
        const h = harness({ utxos: [
            { txid: '66'.repeat(32), vout: 0, value: 90000n, scriptPubKeyHex: `0020${'77'.repeat(32)}` },
            { txid: '88'.repeat(32), vout: 3, value: 150000n },
        ] });
        const session = await startMultisigSend(h.opts);
        const spend = decodeMultisigSpend(session.psbtHex);

        expect(spend.input).toMatchObject({ txid: '88'.repeat(32), vout: 3, amount: 150000n, scriptPubKeyHex });
    });

    it('uses one output when the remainder is dust', async () => {
        const h = harness({ utxos: [
            { txid: '33'.repeat(32), vout: 2, value: 50400n, scriptPubKeyHex },
        ] });
        const session = await startMultisigSend({ ...h.opts, feeRate: 1 });
        const spend = decodeMultisigSpend(session.psbtHex);

        expect(spend.outputs).toHaveLength(1);
        expect(spend.input.amount - spend.outputs[0].value).toBe(400n);
    });

    it('refuses a Taproot multisig source', async () => {
        const taproot = config({
            scheme: 'taproot-musig2',
            scriptTemplate: `musig2:${'44'.repeat(32)}`,
        });
        const h = harness({ multisig: taproot });

        await expect(startMultisigSend(h.opts)).rejects.toThrow(TAPROOT_UNAVAILABLE_MESSAGE);
        expect(h.getUTXOs).not.toHaveBeenCalled();
    });

    it('refuses when no single coin covers amount and fee', async () => {
        const h = harness({ utxos: [
            { txid: '44'.repeat(32), vout: 0, value: 30000n, scriptPubKeyHex },
            { txid: '55'.repeat(32), vout: 1, value: 30000n, scriptPubKeyHex },
        ] });

        await expect(startMultisigSend(h.opts)).rejects.toThrow(NO_SINGLE_COIN_MESSAGE);
    });
});

