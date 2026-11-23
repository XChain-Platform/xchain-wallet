// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { importMnemonic } from '../../../packages/core/src/flows/importMnemonic.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { createConnectedSite } from '../../../packages/core/src/schemas/connectedSite.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';
import { parseSignInChallenge } from '../../../packages/connect/src/runtime.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const CHAIN_ID = 'bitcoin-regtest';
const ORIGIN = 'https://real-sign-in.example';
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'real-sign-in-password';
const KDF = {
    algorithm: 'argon2id',
    salt: Buffer.alloc(16, 23).toString('base64'),
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

let vault;
let walletId;
let accountId;
let address;
let addressType;

beforeAll(async () => {
    vault = new Vault({
        backend: new InMemoryBackend(),
        masterKey: new Uint8Array(32).fill(29),
        autoSave: false,
    });
    await vault.open();
    const imported = await importMnemonic({
        password: PASSWORD,
        mnemonic: MNEMONIC,
        vault,
        chainRegistry,
        sdkRegistry,
        activeChainIds: [CHAIN_ID],
        kdfParams: KDF,
    });
    walletId = imported.wallet.id;
    accountId = imported.account.id;
    address = imported.addresses[0].address.address;
    addressType = imported.addresses[0].address.addressType;
    await vault.connectedSites.put(createConnectedSite({
        origin: ORIGIN,
        appName: 'Real sign-in test',
        permissions: {
            chains: [CHAIN_ID],
            accounts: [accountId],
            canSignMessage: false,
            canSignAction: {},
        },
    }));
});

afterAll(async () => {
    await vault?.close();
});

describe('bridge.signIn real signing path', () => {
    it('returns a verifiable v2 challenge signature after approval', async () => {
        expect(addressType).toBe('p2wpkh');
        const signIn = vi.fn(async () => ({
            approved: true,
            password: PASSWORD,
            walletId,
            address,
            chainId: CHAIN_ID,
        }));
        const host = new MessageHost({ vault, chainRegistry, sdkRegistry });
        registerBridgeHandlers(host, {
            approvals: { signIn },
            signThrottle: { check: () => ({ allowed: true }) },
        });

        const response = await host.handle({
            type: 'bridge.signIn',
            request: {
                origin: ORIGIN,
                appId: 'real-sign-in-test',
                chainId: CHAIN_ID,
                nonce: 'bridge-real-path',
            },
        });

        expect(signIn).toHaveBeenCalledTimes(1);
        expect(response).toMatchObject({
            ok: true,
            result: {
                ok: true,
                address,
                chainId: CHAIN_ID,
                signature: expect.any(String),
                challenge: expect.any(String),
                challengeParts: {
                    version: 2,
                    appId: 'real-sign-in-test',
                    origin: ORIGIN,
                    address,
                    nonce: 'bridge-real-path',
                },
            },
        });
        expect(parseSignInChallenge(response.result.challenge))
            .toEqual(response.result.challengeParts);
        const verdict = sdkRegistry.get(CHAIN_ID).auth.verifyMessage(
            address,
            response.result.challenge,
            response.result.signature,
        );
        expect(typeof verdict === 'boolean' ? verdict : verdict?.valid).toBe(true);
    });
});
