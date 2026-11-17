// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings > Backup's Publish labels on-chain and Check network for
// backed-up contacts ask for no password while the session's signer pool
// holds the wallet's software signer (operator preference 2026-11-14): the
// host hands the label-sync flows that signer's master key (and, to sign the
// publish, the signer itself), as wallet.importWif already does. A typed
// password always wins, and an empty pool leaves the flows to ask for it.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ prepare: [], submit: [], restore: [] }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: {
            ...actual.flows,
            prepareLabelsPublication: async (opts) => { calls.prepare.push(opts); return { chainId: opts.chainId }; },
            submitLabelsPublication: async (opts) => { calls.submit.push(opts); return { txid: 'txid-1' }; },
            restoreLabelSyncAfterImport: async (opts) => { calls.restore.push(opts); return { restored: false }; },
        },
    };
});

const { createBackgroundHost } = await import('../../../packages/extension/src/background/createBackgroundHost.js');

const KDF_PARAMS = { algorithm: 'argon2id', salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: 2, memory: 8192, parallelism: 1 };
const SESSION_KEY = new Uint8Array(32).fill(5);

function hostWith(pooled) {
    return createBackgroundHost({
        vault: {
            wallets: { get: async () => ({ id: 'w1', kdfParams: KDF_PARAMS }) },
            addresses: { list: async () => [] },
            accounts: { findBy: async () => [] },
            settings: { get: async () => null },
        },
        chainRegistry: { get: () => null, list: () => [], supportedChains: () => [] },
        sdkRegistry: { get: () => ({}) },
        signerPool: { get: () => pooled, has: () => Boolean(pooled) },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

const softwareSigner = () => ({ kind: 'software', id: 'w1', getMasterKey: () => SESSION_KEY });

beforeEach(() => {
    calls.prepare.length = 0;
    calls.submit.length = 0;
    calls.restore.length = 0;
});

describe('label sync with the unlocked session signer', () => {
    it('prepares and publishes with the pooled master key and signer when no password is sent', async () => {
        const signer = softwareSigner();
        const host = hostWith(signer);
        const prep = await host.handle({ type: 'wallet.prepareLabels', request: { walletId: 'w1', chainId: 'bitcoin-regtest' } });
        expect(prep.ok, JSON.stringify(prep.error ?? {})).toBe(true);
        expect(calls.prepare[0].masterKey).toBe(SESSION_KEY);
        expect(calls.prepare[0].password).toBeUndefined();

        const pub = await host.handle({
            type: 'wallet.publishLabels',
            request: { walletId: 'w1', chainId: 'bitcoin-regtest', preparation: { chainId: 'bitcoin-regtest' } },
        });
        expect(pub.ok, JSON.stringify(pub.error ?? {})).toBe(true);
        expect(calls.submit[0].signer).toBe(signer);
        expect(calls.submit[0].password).toBeUndefined();
    });

    it('checks the network with the pooled master key and the wallet kdfParams', async () => {
        const host = hostWith(softwareSigner());
        const res = await host.handle({ type: 'wallet.restoreLabels', request: { walletId: 'w1', chainId: 'bitcoin-regtest' } });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(calls.restore[0].masterKey).toBe(SESSION_KEY);
        expect(calls.restore[0].masterKeyKdfParams).toEqual(KDF_PARAMS);
    });

    it('lets a typed password win and leaves an empty pool to the password', async () => {
        const typed = hostWith(softwareSigner());
        await typed.handle({ type: 'wallet.prepareLabels', request: { walletId: 'w1', chainId: 'bitcoin-regtest', password: 'typed' } });
        expect(calls.prepare[0].masterKey).toBeUndefined();
        expect(calls.prepare[0].password).toBe('typed');

        const empty = hostWith(null);
        await empty.handle({ type: 'wallet.restoreLabels', request: { walletId: 'w1', chainId: 'bitcoin-regtest' } });
        expect(calls.restore[0].masterKey).toBeUndefined();

        // A hardware signer has no seed to hand over.
        const hw = hostWith({ kind: 'ledger', id: 'hw', getMasterKey: () => SESSION_KEY });
        await hw.handle({ type: 'wallet.publishLabels', request: { walletId: 'w1', chainId: 'bitcoin-regtest', preparation: { chainId: 'bitcoin-regtest' } } });
        expect(calls.submit[0].signer).toBeUndefined();
    });
});
