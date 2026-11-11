// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { beforeEach, expect, it, vi } from 'vitest';

const unlock = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/flows/unlockWallet.js', () => ({ unlockWallet: unlock }));
vi.mock('../../../packages/core/src/flows/panicMode.js', () => ({ assertSigningAllowed: () => {} }));

import { signMultisigLocally } from '../../../packages/core/src/flows/multisigSignLocally.js';
import {
    contributeMultisigSignature,
    finalizeMultisigSigningSession,
    startMultisigSigningSession,
} from '../../../packages/core/src/flows/multisigSigning.js';
import { buildUnsignedMultisigSpend, multisigSighash } from '../../../packages/core/src/flows/multisigSpend.js';
import { MULTISIG_TRANSACTION_MISMATCH } from '../../../packages/core/src/flows/multisigTransactionBinding.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const bitcoin = require('bitcoinjs-lib');
const sdk = new XChainSDK({ network: 'bitcoin-testnet' });
const secrets = [4, 5, 6].map((byte) => new Uint8Array(32).fill(byte));
const pubkeys = secrets.map((secret) => Buffer.from(secp256k1.getPublicKey(secret, true)).toString('hex'));
const multisig = {
    id: 'config-1',
    scheme: 'p2wsh-multisig',
    threshold: 2,
    scriptTemplate: `multi:2:${pubkeys.join(':')}`,
    cosigners: pubkeys.map((pubkey, index) => ({
        pubkey,
        origin: index === 0 ? 'local' : 'remote',
        derivationPath: `m/48'/1'/0'/2'/0/${index}`,
    })),
};

function harness() {
    const records = new Map();
    const wallet = { id: 'wallet-1', multisigs: [multisig] };
    const vault = {
        wallets: { get: vi.fn(async () => wallet) },
        multisigSigningSessions: {
            get: vi.fn(async (id) => records.get(id)),
            put: vi.fn(async (record) => records.set(record.id, record)),
        },
    };
    const derived = sdk.deriveMultisigAddress({
        scheme: multisig.scheme, scriptTemplate: multisig.scriptTemplate,
    });
    const sourceScript = Buffer.from(bitcoin.address.toOutputScript(
        derived.address, sdk.wallet.getBitcoinNetwork(),
    )).toString('hex');
    const built = buildUnsignedMultisigSpend({
        scheme: multisig.scheme,
        script: derived.witnessScript,
        utxo: { txid: '77'.repeat(32), vout: 0, value: 100000n, scriptPubKeyHex: sourceScript },
        outputs: [{ value: 90000n, scriptPubKeyHex: `76a914${'88'.repeat(20)}88ac` }],
    });
    const msgHash = multisigSighash({
        scheme: multisig.scheme,
        script: derived.witnessScript,
        unsignedTxHex: built.unsignedTxHex,
        amount: 100000n,
    });
    return { records, vault, built, msgHash, sdkRegistry: { get: () => sdk } };
}

async function start(h, msgHash = h.msgHash) {
    return startMultisigSigningSession({
        vault: h.vault,
        walletId: 'wallet-1',
        chainId: 'bitcoin-testnet',
        multisigConfigId: multisig.id,
        msgHash,
        psbtHex: h.built.psbtHex,
    });
}

beforeEach(() => unlock.mockReset());

it('refuses a local signature before unlock when the message hash does not bind the PSBT', async () => {
    const h = harness();
    const session = await start(h, 'ff'.repeat(32));

    await expect(signMultisigLocally({
        vault: h.vault,
        chainRegistry: {},
        sdkRegistry: h.sdkRegistry,
        sessionId: session.id,
        password: 'password',
    })).rejects.toThrow(MULTISIG_TRANSACTION_MISMATCH);
    expect(unlock).not.toHaveBeenCalled();
});

it('signs a bound request and finalizes from stored DER signatures without SDK finalization', async () => {
    const h = harness();
    const session = await start(h);
    const firstSig = Buffer.from(sdk.wallet.signEcdsa(Buffer.from(h.msgHash, 'hex'), secrets[0])).toString('hex');
    const secondSig = Buffer.from(sdk.wallet.signEcdsa(Buffer.from(h.msgHash, 'hex'), secrets[1])).toString('hex');
    unlock.mockResolvedValue({
        kind: 'software',
        lock: vi.fn(),
        signMultisigClassical: vi.fn().mockResolvedValue({ sig: firstSig }),
    });

    const local = await signMultisigLocally({
        vault: h.vault,
        chainRegistry: {},
        sdkRegistry: h.sdkRegistry,
        sessionId: session.id,
        password: 'password',
    });
    expect(local.contributionKind).toBe('classical-signature');
    await contributeMultisigSignature({
        vault: h.vault,
        sdkRegistry: h.sdkRegistry,
        sessionId: session.id,
        pubkey: pubkeys[1],
        signatureHex: secondSig,
    });
    const finalizeSpy = vi.spyOn(sdk.wallet, 'finalizeMultisigPsbt');
    const finalized = await finalizeMultisigSigningSession({
        vault: h.vault,
        sdkRegistry: h.sdkRegistry,
        sessionId: session.id,
    });

    expect(finalized).toMatchObject({ status: 'finalized', txid: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(finalized.finalizedTxHex).toMatch(/^020000000001/);
    expect(finalizeSpy).not.toHaveBeenCalled();
    finalizeSpy.mockRestore();
});

