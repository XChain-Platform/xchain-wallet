// @vitest-environment node

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A revoke can wait in the vault write queue behind an earlier save while a
// bridge request still reads the grant from memory. Every bridge write to that
// grant queues behind the revoke, so it must land only on the record still held
// when it runs; a write from the stale snapshot would put the revoked grant back
// with its id and permissions, and the next request would be served as before.

import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { importMnemonic } from '../../../../packages/core/src/flows/importMnemonic.js';
import { defaultRegistry } from '../../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../../packages/core/src/sdk/SDKRegistry.js';
import { createConnectedSite } from '../../../../packages/core/src/schemas/connectedSite.js';
import { Vault } from '../../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../../packages/core/src/storage/backend.js';
import { MessageHost } from '../../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../../packages/extension/src/bridge/handlers.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const CHAIN_ID = 'bitcoin-regtest';
const ORIGIN = 'https://revoke-race.example';
const OTHER_ORIGIN = 'https://unrelated.example';
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'revoke-race-password';
const KDF = {
    algorithm: 'argon2id',
    salt: Buffer.alloc(16, 31).toString('base64'),
    iterations: 1,
    memory: 8192,
    parallelism: 1,
};

// A backend whose next save waits until the test releases it, so writes queued
// behind that save have not run while a request reads the in-memory document.
class HeldBackend extends InMemoryBackend {
    constructor() {
        super();
        this._gate = null;
    }

    hold() {
        let release;
        this._gate = new Promise((resolve) => { release = resolve; });
        return () => { this._gate = null; release(); };
    }

    async save(blob, options) {
        if (this._gate) await this._gate;
        return super.save(blob, options);
    }
}

const chainRegistry = defaultRegistry();
const sdkRegistry = new SDKRegistry({
    chainRegistry,
    sdkFactory: adaptXChainSDK(XChainSDK),
    rateLimiter: null,
});

let backend;
let vault;
let accountId;
let address;

beforeAll(async () => {
    backend = new HeldBackend();
    vault = new Vault({ backend, masterKey: new Uint8Array(32).fill(37), autoSave: true });
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
    accountId = imported.account.id;
    address = imported.addresses[0].address.address;
});

afterAll(async () => {
    await vault?.close();
});

// Each case starts from one grant for the origin, whatever an earlier case left.
async function grantSite(canSignMessage = false) {
    for (const stale of await vault.connectedSites.findBy('origin', ORIGIN)) {
        await vault.connectedSites.delete(stale.id);
    }
    const site = createConnectedSite({
        origin: ORIGIN,
        appName: 'Revoke race test',
        permissions: { chains: [CHAIN_ID], accounts: [accountId], canSignMessage, canSignAction: {} },
    });
    await vault.connectedSites.put(site);
    return site;
}

// Starts an unrelated write whose save is held, then queues the revoke behind
// it: the grant stays readable in memory until release() lets both run.
function queueRevokeBehindHeldSave(siteId) {
    const release = backend.hold();
    const unrelated = vault.connectedSites.put(createConnectedSite({
        origin: OTHER_ORIGIN,
        appName: 'Unrelated',
        permissions: { chains: [CHAIN_ID], accounts: [accountId], canSignMessage: false, canSignAction: {} },
    }));
    const revoked = vault.connectedSites.delete(siteId);
    return { release, settled: Promise.all([unrelated, revoked]) };
}

function hostWith(approvals) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry });
    registerBridgeHandlers(host, { approvals, signThrottle: { check: () => ({ allowed: true }) } });
    return host;
}

function signMessage(host, message = 'hello') {
    return host.handle({
        type: 'bridge.signMessage',
        request: { origin: ORIGIN, chainId: CHAIN_ID, address, message },
    });
}

const turns = (ms = 25) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function grantsFor(origin) {
    return vault.connectedSites.findBy('origin', origin);
}

describe('a revoke queued behind a save stays revoked', () => {
    it('refuses a signMessage that read the grant before the revoke ran', async () => {
        const site = await grantSite();
        const approvals = { signMessage: async () => ({ approved: true, password: PASSWORD }) };
        const { release, settled } = queueRevokeBehindHeldSave(site.id);

        const response = signMessage(hostWith(approvals));
        await turns();
        release();
        const [answer] = await Promise.all([response, settled]);

        expect(answer.ok).toBe(false);
        expect(answer.error.code).toBe('NOT_CONNECTED');
        expect(await grantsFor(ORIGIN)).toEqual([]);
    });

    it('keeps the grant deleted when the racing request is malformed', async () => {
        const site = await grantSite();
        const { release, settled } = queueRevokeBehindHeldSave(site.id);

        const response = signMessage(hostWith({}), 42);
        await turns();
        release();
        const [answer] = await Promise.all([response, settled]);

        expect(answer.ok).toBe(false);
        expect(await grantsFor(ORIGIN)).toEqual([]);
    });

    it('drops the savePermanent widening of a grant revoked while it signed', async () => {
        const site = await grantSite();
        let race = null;
        const approvals = {
            signMessage: async () => {
                // The user revokes while this prompt answers: the grant is still
                // in memory when the signature is made.
                race = queueRevokeBehindHeldSave(site.id);
                return { approved: true, password: PASSWORD, savePermanent: true };
            },
        };

        const response = signMessage(hostWith(approvals));
        while (!race) await turns(5);
        await turns(200);
        race.release();
        const [answer] = await Promise.all([response, race.settled]);

        expect(answer.ok).toBe(true);
        expect(answer.result.signature).toEqual(expect.any(String));
        expect(await grantsFor(ORIGIN)).toEqual([]);
    });

    it('stamps and widens the same grant when nothing revokes it', async () => {
        const site = await grantSite();
        await turns(5);
        const approvals = { signMessage: async () => ({ approved: true, password: PASSWORD, savePermanent: true }) };

        const answer = await signMessage(hostWith(approvals));

        expect(answer.ok).toBe(true);
        const [held] = await grantsFor(ORIGIN);
        expect(held.id).toBe(site.id);
        expect(held.permissions).toEqual({ ...site.permissions, canSignMessage: true });
        expect(Date.parse(held.lastUsedAt)).toBeGreaterThan(Date.parse(site.lastUsedAt));
    });
});
