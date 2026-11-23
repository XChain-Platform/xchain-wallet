// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The tracker serves every UTXO with `value` in integer satoshis and `amount`
// as the same figure in whole coins. The multisig coin read takes the satoshi
// fields only, and a reply that is not a coin list is a failed read rather than
// an empty wallet.

import { createRequire } from 'node:module';
import { secp256k1 } from '@noble/curves/secp256k1';
import { describe, expect, it, vi } from 'vitest';
import { startMultisigSend } from '../../../packages/core/src/flows/multisigSend.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const bitcoin = require('bitcoinjs-lib');
const realSdk = new XChainSDK({ network: 'bitcoin-testnet' });
const pubkeys = [1, 2, 3].map((byte) => Buffer.from(
    secp256k1.getPublicKey(new Uint8Array(32).fill(byte), true),
).toString('hex'));
const destination = realSdk.wallet.deriveAddress(
    secp256k1.getPublicKey(new Uint8Array(32).fill(9), true), { type: 'p2pkh' },
);
const multisig = {
    id: 'multisig-1',
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosigners: pubkeys.map((pubkey, index) => ({ pubkey, name: `Signer ${index + 1}` })),
    scriptTemplate: `multi:2:${pubkeys.join(':')}`,
};
const scriptPubKeyHex = Buffer.from(bitcoin.address.toOutputScript(
    realSdk.deriveMultisigAddress({ scheme: multisig.scheme, scriptTemplate: multisig.scriptTemplate }).address,
    realSdk.wallet.getBitcoinNetwork(),
)).toString('hex');

function opts(reply) {
    const wallet = { id: 'wallet-1', multisigs: [multisig] };
    const sdk = {
        deriveMultisigAddress: realSdk.deriveMultisigAddress.bind(realSdk),
        validateAddress: realSdk.validateAddress.bind(realSdk),
        wallet: { getBitcoinNetwork: realSdk.wallet.getBitcoinNetwork.bind(realSdk.wallet) },
        encoder: { getUTXOs: vi.fn().mockResolvedValue(reply) },
    };
    return {
        vault: {
            wallets: { get: vi.fn(async () => wallet) },
            multisigSigningSessions: { put: vi.fn(async () => {}) },
        },
        sdkRegistry: { get: vi.fn(() => sdk) },
        walletId: wallet.id,
        chainId: 'bitcoin-testnet',
        multisigConfigId: multisig.id,
        destination,
        amountSats: 50000n,
        feeRate: 2,
    };
}

const coin = (fields) => ({ txid: 'aa'.repeat(32), vout: 0, scriptPubKeyHex, ...fields });

describe('startMultisigSend coin read', () => {
    it('never reads the whole-coin amount field as satoshis', async () => {
        await expect(startMultisigSend(opts([coin({ amount: '100000' })])))
            .rejects.toThrow(/UTXO value/);
    });

    it('reads the satoshi value from the tracker shape that carries both fields', async () => {
        const session = await startMultisigSend(opts({ utxos: [coin({ value: 200000, amount: '0.00200000' })] }));
        expect(session.psbtHex).toMatch(/^[0-9a-f]+$/);
    });

    it('treats a reply that is not a coin list as a failed read, not as no coins', async () => {
        await expect(startMultisigSend(opts({ error: 'unavailable' })))
            .rejects.toThrow(/did not return a coin list/);
        await expect(startMultisigSend(opts(null)))
            .rejects.toThrow(/did not return a coin list/);
    });

    it('still reports an honest empty list as no covering coin', async () => {
        await expect(startMultisigSend(opts([])))
            .rejects.toThrow(/No single coin/);
    });
});
