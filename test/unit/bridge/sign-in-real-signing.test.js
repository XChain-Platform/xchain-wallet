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

const CHAIN_IDS = ['bitcoin-regtest', 'litecoin-regtest'];
const CHAIN_ID = CHAIN_IDS[0];
const ORIGIN = 'https://real-sign-in.example';
const FRESH_ORIGIN = 'https://fresh-sign-in.example';
const LINK_ORIGIN = 'https://link-sign-in.example';
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
let loginAddresses;

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
        activeChainIds: CHAIN_IDS,
        kdfParams: KDF,
    });
    walletId = imported.wallet.id;
    accountId = imported.account.id;
    address = imported.addresses[0].address.address;
    addressType = imported.addresses[0].address.addressType;
    loginAddresses = imported.addresses.map(({ chainId, address: record }) => ({
        address: record.address,
        chainId,
        addressType: record.addressType,
    }));
    await vault.connectedSites.put(createConnectedSite({
        origin: ORIGIN,
        appName: 'Real sign-in test',
        permissions: {
            chains: CHAIN_IDS,
            accounts: [accountId],
            addresses: loginAddresses.map((entry) => entry.address),
            canSignMessage: false,
            canSignAction: {},
        },
    }));
});

afterAll(async () => {
    await vault?.close();
});

describe('bridge.login real signing path', () => {
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

    it('returns one verifiable proof per approved address after one prompt', async () => {
        const signIn = vi.fn(async () => ({
            approved: true,
            password: PASSWORD,
            walletId,
            address,
            chainId: CHAIN_ID,
            addresses: loginAddresses,
        }));
        const host = new MessageHost({ vault, chainRegistry, sdkRegistry });
        registerBridgeHandlers(host, {
            approvals: { signIn },
            signThrottle: { check: () => ({ allowed: true }) },
        });

        const response = await host.handle({
            type: 'bridge.login',
            request: {
                origin: ORIGIN,
                appId: 'real-login-test',
                nonce: 'bridge-multi-proof',
                maxAddresses: 5,
            },
        });

        expect(signIn).toHaveBeenCalledTimes(1);
        expect(response.ok).toBe(true);
        expect(response.result.addresses).toHaveLength(loginAddresses.length);
        expect(response.result.addresses.map(({ address: proofAddress }) => proofAddress))
            .toEqual(loginAddresses.map(({ address: heldAddress }) => heldAddress));
        for (const proof of response.result.addresses) {
            const parts = parseSignInChallenge(proof.challenge);
            expect(parts).toMatchObject({
                appId: 'real-login-test',
                origin: ORIGIN,
                address: proof.address,
                nonce: 'bridge-multi-proof',
            });
            const verdict = sdkRegistry.get(proof.chainId).auth.verifyMessage(
                proof.address,
                proof.challenge,
                proof.signature,
            );
            expect(typeof verdict === 'boolean' ? verdict : verdict?.valid).toBe(true);
        }
    });

    it('stores approved addresses in a new site grant', async () => {
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
            type: 'bridge.login',
            request: {
                origin: FRESH_ORIGIN,
                appId: 'fresh-login-test',
                chainId: CHAIN_ID,
                nonce: 'fresh-grant-path',
            },
        });
        const [grant] = await vault.connectedSites.findBy('origin', FRESH_ORIGIN);

        expect(response).toMatchObject({ ok: true, result: { ok: true, address } });
        expect(grant.permissions).toMatchObject({
            chains: [CHAIN_ID],
            accounts: [accountId],
            addresses: [address],
        });
        await vault.connectedSites.delete(grant.id);
    });

    it('refuses a proof when its address grant is removed during approval', async () => {
        const [site] = await vault.connectedSites.findBy('origin', ORIGIN);
        const originalPermissions = site.permissions;
        const signIn = vi.fn(async () => {
            await vault.connectedSites.update(site.id, (current) => {
                const { addresses: _addresses, ...permissions } = current.permissions;
                return { ...current, permissions };
            });
            return {
                approved: true,
                password: PASSWORD,
                walletId,
                address,
                chainId: CHAIN_ID,
            };
        });
        const host = new MessageHost({ vault, chainRegistry, sdkRegistry });
        registerBridgeHandlers(host, {
            approvals: { signIn },
            signThrottle: { check: () => ({ allowed: true }) },
        });

        try {
            const response = await host.handle({
                type: 'bridge.login',
                request: {
                    origin: ORIGIN,
                    appId: 'revoked-login-test',
                    chainId: CHAIN_ID,
                    nonce: 'revoked-address-path',
                },
            });
            expect(response).toMatchObject({
                ok: false,
                error: { code: 'ADDRESS_NOT_AUTHORIZED' },
            });
        } finally {
            await vault.connectedSites.update(site.id, (current) => ({
                ...current,
                permissions: originalPermissions,
            }));
        }
    });

    it('keeps link login grant-free and blocks listed link origins before prompting', async () => {
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
            grantFreeSiteContext: true,
        });

        const approved = await host.handle({
            type: 'bridge.login',
            request: {
                origin: LINK_ORIGIN,
                appId: 'link-login-test',
                chainId: CHAIN_ID,
                nonce: 'link-grant-free-path',
            },
        });
        expect(approved).toMatchObject({ ok: true, result: { ok: true, address } });
        expect(await vault.connectedSites.findBy('origin', LINK_ORIGIN)).toEqual([]);

        const settings = await vault.settings.get();
        await vault.settings.put({ ...settings, blockedOrigins: [LINK_ORIGIN] });
        signIn.mockClear();
        try {
            const blocked = await host.handle({
                type: 'bridge.login',
                request: {
                    origin: LINK_ORIGIN,
                    appId: 'link-login-test',
                    chainId: CHAIN_ID,
                    nonce: 'link-blocked-path',
                },
            });
            expect(blocked).toMatchObject({
                ok: false,
                error: { code: 'BLOCKED_BY_USER' },
            });
            expect(signIn).not.toHaveBeenCalled();
        } finally {
            await vault.settings.put(settings);
        }
    });
});
