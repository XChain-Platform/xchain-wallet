// @vitest-environment node

import { createRequire } from 'node:module';
import { sha256 } from '@noble/hashes/sha2';
import { secp256k1 } from '@noble/curves/secp256k1';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importMultisigSigningRequest } from '../../../packages/core/src/flows/multisigImportRequest.js';
import {
    buildUnsignedMultisigSpend,
    decodeMultisigSpend,
    multisigSighash,
} from '../../../packages/core/src/flows/multisigSpend.js';
import { MULTISIG_TRANSACTION_MISMATCH } from '../../../packages/core/src/flows/multisigTransactionBinding.js';
import { buildRequestEnvelope } from '../../../packages/core/src/uri/multisigPsbtEnvelope.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-testnet' });
const PUBKEYS = [1, 2, 3].map((byte) => Buffer.from(
    secp256k1.getPublicKey(new Uint8Array(32).fill(byte), true),
).toString('hex'));

function makeConfig(pubkeys = PUBKEYS) {
    return {
        id: 'multisig-1',
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosigners: pubkeys.map((pubkey) => ({ pubkey })),
        scriptTemplate: `multi:2:${pubkeys.join(':')}`,
    };
}

function makeHarness() {
    const records = new Map();
    const wallet = { id: 'wallet-1', multisigs: [makeConfig()] };
    const derived = sdk.deriveMultisigAddress({
        scheme: wallet.multisigs[0].scheme,
        scriptTemplate: wallet.multisigs[0].scriptTemplate,
    });
    const scriptBytes = Uint8Array.from(derived.witnessScript.match(/../g)
        .map((byte) => Number.parseInt(byte, 16)));
    const scriptPubKeyHex = `0020${Buffer.from(sha256(scriptBytes)).toString('hex')}`;
    const { psbtHex } = buildUnsignedMultisigSpend({
        scheme: 'p2wsh-multisig',
        script: derived.witnessScript,
        utxo: { txid: '11'.repeat(32), vout: 0, value: 100000n, scriptPubKeyHex },
        outputs: [{ value: 90000n, scriptPubKeyHex: `76a914${'55'.repeat(20)}88ac` }],
    });
    const spend = decodeMultisigSpend(psbtHex);
    const msgHash = multisigSighash({
        scheme: 'p2wsh-multisig',
        script: derived.witnessScript,
        unsignedTxHex: spend.unsignedTxHex,
        amount: spend.input.amount,
    });
    const vault = {
        wallets: { get: vi.fn(async () => wallet) },
        multisigSigningSessions: {
            list: vi.fn(async () => [...records.values()]),
            put: vi.fn(async (record) => { records.set(record.id, record); }),
        },
    };
    const sdkRegistry = { get: vi.fn(() => sdk) };
    const envelope = buildRequestEnvelope({
        kind: 'multisig-request-signature',
        sessionRef: {
            chainId: 'bitcoin-testnet',
            scheme: 'p2wsh-multisig',
            threshold: 2,
            cosignerPubkeys: PUBKEYS,
            msgHash,
            psbtHex,
        },
    });
    return { records, wallet, vault, sdkRegistry, envelope };
}

describe('importMultisigSigningRequest', () => {
    let harness;

    beforeEach(() => { harness = makeHarness(); });

    it('creates a local session and returns the same one on a second import', async () => {
        const first = await importMultisigSigningRequest({
            vault: harness.vault,
            sdkRegistry: harness.sdkRegistry,
            walletId: harness.wallet.id,
            envelope: harness.envelope,
        });
        const second = await importMultisigSigningRequest({
            vault: harness.vault,
            sdkRegistry: harness.sdkRegistry,
            walletId: harness.wallet.id,
            envelope: harness.envelope,
        });

        expect(first.created).toBe(true);
        expect(second).toEqual({ sessionId: first.sessionId, created: false });
        expect(harness.records).toHaveLength(1);
    });

    it('refuses a request whose message hash does not bind to its transaction', async () => {
        const envelope = buildRequestEnvelope({
            kind: 'multisig-request-signature',
            sessionRef: { ...harness.envelope.sessionRef, msgHash: 'ff'.repeat(32) },
        });
        await expect(importMultisigSigningRequest({
            vault: harness.vault, sdkRegistry: harness.sdkRegistry,
            walletId: harness.wallet.id, envelope,
        })).rejects.toThrow(MULTISIG_TRANSACTION_MISMATCH);
    });

    it('refuses a multisig this wallet does not belong to', async () => {
        harness.wallet.multisigs = [makeConfig([PUBKEYS[0], PUBKEYS[1], `02${'99'.repeat(32)}`])];
        await expect(importMultisigSigningRequest({
            vault: harness.vault, sdkRegistry: harness.sdkRegistry,
            walletId: harness.wallet.id, envelope: harness.envelope,
        })).rejects.toThrow('This signing request is for a multisig this wallet does not belong to.');
    });

    it('refuses taproot requests in this cut', async () => {
        const envelope = buildRequestEnvelope({
            kind: 'multisig-request-nonce',
            sessionRef: {
                ...harness.envelope.sessionRef,
                scheme: 'taproot-musig2',
                threshold: 3,
            },
        });
        await expect(importMultisigSigningRequest({
            vault: harness.vault, sdkRegistry: harness.sdkRegistry,
            walletId: harness.wallet.id, envelope,
        })).rejects.toThrow('Taproot signing requests can\'t be opened from a link yet.');
    });

    it('refuses requests without a transaction in plain words', async () => {
        const envelope = buildRequestEnvelope({
            kind: 'multisig-request-signature',
            sessionRef: { ...harness.envelope.sessionRef, psbtHex: '' },
        });
        await expect(importMultisigSigningRequest({
            vault: harness.vault, sdkRegistry: harness.sdkRegistry,
            walletId: harness.wallet.id, envelope,
        })).rejects.toThrow('This signing request doesn\'t include a transaction to review.');
    });
});
