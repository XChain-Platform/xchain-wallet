// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { importMnemonic } from '../../../packages/core/src/flows/importMnemonic.js';
import { signMessageFlow } from '../../../packages/core/src/flows/signFlows.js';
import { unlockWallet } from '../../../packages/core/src/flows/unlockWallet.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'message-round-trip-password';
const MESSAGE = 'Sign message to Verify signature offline round trip.';
const KDF = {
    algorithm: 'argon2id',
    salt: Buffer.alloc(16, 11).toString('base64'),
    iterations: 1,
    memory: 8192,
    parallelism: 1,
};

const chainRegistry = defaultRegistry();
const sdkRegistry = new SDKRegistry({
    chainRegistry,
    sdkFactory: adaptXChainSDK(XChainSDK),
    rateLimiter: null,
});

const messageSigningChains = chainRegistry.supportedChains().filter((descriptor) => {
    const sdk = sdkRegistry.get(descriptor.id);
    return typeof sdk?.auth?.signMessage === 'function'
        && typeof sdk?.auth?.verifyMessage === 'function';
});
const verifiableCases = messageSigningChains.flatMap((descriptor) => (
    descriptor.addressTypes
        .filter((addressType) => addressType !== 'p2tr')
        .map((addressType) => ({
            chainId: descriptor.id,
            addressType,
        }))
));
const unsupportedTaprootCases = messageSigningChains.flatMap((descriptor) => (
    descriptor.addressTypes.includes('p2tr')
        ? [{ chainId: descriptor.id, addressType: 'p2tr' }]
        : []
));

let vault;
let walletId;
let signer;
let verifyHost;

beforeAll(async () => {
    vault = new Vault({
        backend: new InMemoryBackend(),
        masterKey: new Uint8Array(32).fill(17),
        autoSave: false,
    });
    await vault.open();
    const imported = await importMnemonic({
        password: PASSWORD,
        mnemonic: MNEMONIC,
        vault,
        chainRegistry,
        sdkRegistry,
        activeChainIds: messageSigningChains.map((descriptor) => descriptor.id),
        kdfParams: KDF,
    });
    walletId = imported.wallet.id;
    signer = await unlockWallet({
        vault,
        walletId,
        password: PASSWORD,
        chainRegistry,
        sdkRegistry,
    });
    verifyHost = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        signerPool: {},
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
});

afterAll(async () => {
    signer?.lock();
    await vault?.close();
});

describe.each(verifiableCases)('$chainId $addressType message signing', ({
    chainId,
    addressType,
}) => {
    it('returns Valid through the production sign and verify paths', async () => {
        const [derived] = await signer.getAddresses({
            chainId,
            accountIndex: 0,
            change: 0,
            startIndex: 0,
            count: 1,
            addressType,
        });
        const signed = await signMessageFlow({
            vault,
            walletId,
            signer,
            chainRegistry,
            sdkRegistry,
            chainId,
            path: derived.path,
            message: MESSAGE,
        });
        const verified = await verifyHost.handle({
            type: 'auth.verifyMessage',
            request: {
                chainId,
                address: derived.address,
                message: MESSAGE,
                signature: signed.signature,
            },
        });

        expect(verified).toMatchObject({ ok: true, result: { valid: true } });
    });
});

describe.each(unsupportedTaprootCases)('$chainId $addressType message signing, not yet derivable', ({
    chainId,
    addressType,
}) => {
    it('reports the SDK derivation limitation explicitly', async () => {
        await expect(signer.getAddresses({
            chainId,
            accountIndex: 0,
            change: 0,
            startIndex: 0,
            count: 1,
            addressType,
        })).rejects.toThrow('Unknown address type: "p2tr"');
    });
});
