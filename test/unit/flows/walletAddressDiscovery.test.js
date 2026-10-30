// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Used-address discovery after a restore, over a real imported wallet and its
// real software signer, against a fake explorer. The recovery phrase is
// generated at run time and never printed.

import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateBip39Mnemonic } from '../../../packages/core/src/crypto/mnemonic.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { importMnemonic } from '../../../packages/core/src/flows/importMnemonic.js';
import { unlockWallet } from '../../../packages/core/src/flows/unlockWallet.js';
import { _resetBatchSupportMemo } from '../../../packages/core/src/flows/balances.js';
import {
    DISCOVERY_GAP_LIMIT,
    discoverWalletAddresses,
} from '../../../packages/core/src/flows/walletAddressDiscovery.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const CHAIN_ID = 'bitcoin-regtest';
const PASSWORD = 'discovery-test-pw';
const KDF = { algorithm: 'argon2id', salt: Buffer.alloc(16, 7).toString('base64'), iterations: 1, memory: 8192, parallelism: 1 };

function unusedBody(address) {
    return {
        balances: { data: [], total: 0 },
        address: {
            address,
            balances: { confirmed: '0', pending: '0', received: '0' },
            utxos: { confirmed: 0, pending: 0 },
            tracker_available: true,
        },
    };
}

function usedBody(address) {
    const body = unusedBody(address);
    body.address.balances = { confirmed: '0.5', pending: '0', received: '0.5' };
    body.address.utxos = { confirmed: 1, pending: 0 };
    return body;
}

// A fake explorer serving the batch route. `reply(address)` decides each
// entry; every request is recorded.
function fakeExplorer(reply) {
    const requests = [];
    const sdk = {
        async getBalancesBatch(addresses) {
            requests.push(addresses.slice());
            const out = {};
            for (const address of addresses) out[address] = reply(address);
            return out;
        },
    };
    return { sdk, requests, sdkRegistry: { get: () => sdk } };
}

async function restoredWallet() {
    const chainRegistry = defaultRegistry();
    const sdkRegistry = new SDKRegistry({ chainRegistry, sdkFactory: adaptXChainSDK(XChainSDK), rateLimiter: null });
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: randomBytes(32), autoSave: false });
    await vault.open();
    const r = await importMnemonic({
        password: PASSWORD,
        mnemonic: generateBip39Mnemonic(128),
        vault,
        chainRegistry,
        sdkRegistry,
        activeChainIds: [CHAIN_ID],
        kdfParams: KDF,
    });
    const signer = await unlockWallet({ vault, walletId: r.wallet.id, password: PASSWORD, chainRegistry, sdkRegistry });
    const [first] = await vault.addresses.list();
    return { chainRegistry, vault, walletId: r.wallet.id, signer, addressType: first.addressType };
}

async function deriveAt(signer, addressType, change, index) {
    const [d] = await signer.getAddresses({ chainId: CHAIN_ID, accountIndex: 0, change, startIndex: index, count: 1, addressType });
    return d;
}

beforeEach(() => _resetBatchSupportMemo());

describe('discoverWalletAddresses', () => {
    it('finds funds at receive index 7 and change index 3 and writes both', async () => {
        const w = await restoredWallet();
        const receive7 = await deriveAt(w.signer, w.addressType, 0, 7);
        const change3 = await deriveAt(w.signer, w.addressType, 1, 3);
        const funded = new Set([receive7.address, change3.address]);
        const explorer = fakeExplorer((a) => (funded.has(a) ? usedBody(a) : unusedBody(a)));

        const result = await discoverWalletAddresses({
            vault: w.vault, walletId: w.walletId, signer: w.signer,
            chainRegistry: w.chainRegistry, sdkRegistry: explorer.sdkRegistry,
        });

        expect(result.found).toBe(2);
        expect(result.chains).toEqual([{ chainId: CHAIN_ID, status: 'complete', found: 2, error: null }]);
        const stored = await w.vault.addresses.list();
        const byAddress = new Map(stored.map((a) => [a.address, a]));
        expect(byAddress.get(receive7.address)).toMatchObject({
            derivationPath: receive7.path, addressType: w.addressType, source: 'hd', label: 'BTC Address #8',
        });
        expect(byAddress.get(change3.address)).toMatchObject({
            derivationPath: change3.path, role: 'change', label: 'BTC Change #1',
        });
        // One batch read per 20 addresses: receive 0..39 (used at 7, gap ends
        // at 27) and change 0..39 (used at 3, gap ends at 23).
        expect(explorer.requests).toHaveLength(4);
        expect(explorer.requests.every((batch) => batch.length === 20)).toBe(true);
    });

    it('stops a branch after 20 unused addresses in a row', async () => {
        const w = await restoredWallet();
        const receive7 = await deriveAt(w.signer, w.addressType, 0, 7);
        const beyondGap = await deriveAt(w.signer, w.addressType, 0, 7 + DISCOVERY_GAP_LIMIT + 1);
        const funded = new Set([receive7.address, beyondGap.address]);
        const explorer = fakeExplorer((a) => (funded.has(a) ? usedBody(a) : unusedBody(a)));

        const result = await discoverWalletAddresses({
            vault: w.vault, walletId: w.walletId, signer: w.signer,
            chainRegistry: w.chainRegistry, sdkRegistry: explorer.sdkRegistry,
        });

        expect(DISCOVERY_GAP_LIMIT).toBe(20);
        expect(result.found).toBe(1);
        const stored = (await w.vault.addresses.list()).map((a) => a.address);
        expect(stored).toContain(receive7.address);
        expect(stored).not.toContain(beyondGap.address);
    });

    it('stops the chain with a failure on a reply it does not recognise, never reading it as unused', async () => {
        const w = await restoredWallet();
        const receive3 = await deriveAt(w.signer, w.addressType, 0, 3);
        const explorer = fakeExplorer((a) => {
            if (a === receive3.address) {
                const body = unusedBody(a);
                body.address.tracker_available = false;
                body.address.balances = { confirmed: null, pending: null, received: null };
                return body;
            }
            return unusedBody(a);
        });

        const result = await discoverWalletAddresses({
            vault: w.vault, walletId: w.walletId, signer: w.signer,
            chainRegistry: w.chainRegistry, sdkRegistry: explorer.sdkRegistry,
        });

        expect(result.found).toBe(0);
        expect(result.chains).toHaveLength(1);
        expect(result.chains[0]).toMatchObject({ chainId: CHAIN_ID, status: 'failed' });
        expect(result.chains[0].error).toMatch(/not readable/);
        // The scan stopped at the first window: no change-branch read followed.
        expect(explorer.requests).toHaveLength(1);
    });

    it('fails the chain when the batch entry carries an error', async () => {
        const w = await restoredWallet();
        const explorer = fakeExplorer(() => ({ error: { error: 'busy', code: 'RATE_LIMITED' } }));
        const result = await discoverWalletAddresses({
            vault: w.vault, walletId: w.walletId, signer: w.signer,
            chainRegistry: w.chainRegistry, sdkRegistry: explorer.sdkRegistry,
        });
        expect(result.chains[0]).toMatchObject({ status: 'failed', error: 'busy' });
    });

    it('derives only on the receive and change branches of the account and type the wallet holds', async () => {
        const w = await restoredWallet();
        const calls = [];
        const signer = {
            id: w.signer.id,
            kind: w.signer.kind,
            getAddresses: (opts) => {
                calls.push(opts);
                return w.signer.getAddresses(opts);
            },
        };
        const explorer = fakeExplorer((a) => unusedBody(a));
        await discoverWalletAddresses({
            vault: w.vault, walletId: w.walletId, signer,
            chainRegistry: w.chainRegistry, sdkRegistry: explorer.sdkRegistry,
        });
        const [held] = await w.vault.addresses.list();
        const heldPrefix = held.derivationPath.split('/').slice(0, -2).join('/');
        const scopes = new Set(calls.map((c) => JSON.stringify([c.chainId, c.accountIndex, c.change, c.addressType])));
        expect([...scopes]).toEqual([
            JSON.stringify([CHAIN_ID, 0, 0, w.addressType]),
            JSON.stringify([CHAIN_ID, 0, 1, w.addressType]),
        ]);
        const changeCall = calls.find((c) => c.change === 1);
        const derived = await w.signer.getAddresses({ ...changeCall, count: 1 });
        expect(derived[0].path.startsWith(`${heldPrefix}/1/`)).toBe(true);
        expect(await w.vault.addresses.list()).toHaveLength(1);
    });

    it('fails the chain when the explorer never answers, instead of checking forever', async () => {
        const w = await restoredWallet();
        const sdk = { getBalancesBatch: () => new Promise(() => {}) };
        const result = await discoverWalletAddresses({
            vault: w.vault, walletId: w.walletId, signer: w.signer,
            chainRegistry: w.chainRegistry, sdkRegistry: { get: () => sdk }, readTimeoutMs: 50,
        });
        expect(result.chains[0]).toMatchObject({ status: 'failed', found: 0 });
        expect(result.chains[0].error).toMatch(/did not answer/);
    });

    it('falls back to per-address reads when the explorer has no batch route', async () => {
        const w = await restoredWallet();
        const receive2 = await deriveAt(w.signer, w.addressType, 0, 2);
        const reads = [];
        const sdk = {
            async getBalancesBatch() {
                const e = new Error('Explorer does not serve /balances');
                e.code = 'EXPLORER_BATCH_UNSUPPORTED';
                throw e;
            },
            async getBalances(a) { reads.push(['balances', a]); return { data: [], total: 0 }; },
            async getAddress(a) {
                reads.push(['address', a]);
                return a === receive2.address ? usedBody(a).address : unusedBody(a).address;
            },
        };
        const result = await discoverWalletAddresses({
            vault: w.vault, walletId: w.walletId, signer: w.signer,
            chainRegistry: w.chainRegistry, sdkRegistry: { get: () => sdk },
        });
        expect(result.found).toBe(1);
        expect(reads.length).toBeGreaterThan(0);
    });

    it('reads nothing for a demo wallet', async () => {
        const w = await restoredWallet();
        const wallet = await w.vault.wallets.get(w.walletId);
        await w.vault.wallets.put({ ...wallet, origin: 'demo' });
        const explorer = fakeExplorer((a) => usedBody(a));
        const result = await discoverWalletAddresses({
            vault: w.vault, walletId: w.walletId, signer: w.signer,
            chainRegistry: w.chainRegistry, sdkRegistry: explorer.sdkRegistry,
        });
        expect(result).toEqual({ found: 0, chains: [] });
        expect(explorer.requests).toHaveLength(0);
    });
});
