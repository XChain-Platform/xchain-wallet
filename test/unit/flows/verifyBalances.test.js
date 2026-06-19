// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §7/§8 SPV verdict normalization. The flow wraps the SDK light
// client and maps its results to {verified, failed, unavailable}. Only a
// concrete proof-vs-amount contradiction is `failed`; quorum/checkpoint/
// transport problems degrade to `unavailable` (never a false alarm on the
// convenience path). Transport throws never escape the flow.

import { describe, it, expect } from 'vitest';
import {
    verifyAddressBalance,
    verifyAddressAction,
} from '../../../packages/core/src/flows/verifyBalances.js';

// Build a registry whose single SDK carries a fake light client + explorer
// surface. `lightImpl` is the verifyBalance/verifyAction stub; `explorer`
// overrides baseUrl/port/coin. Passing `light: null` simulates an SDK that
// cannot do SPV.
function makeRegistry({ light, verifyBalance, verifyAction, explorer } = {}) {
    const calls = [];
    const lightClient = light === null ? undefined : {
        verifyBalance: verifyBalance
            ? async (opts) => { calls.push(['balance', opts]); return verifyBalance(opts); }
            : undefined,
        verifyAction: verifyAction
            ? async (opts) => { calls.push(['action', opts]); return verifyAction(opts); }
            : undefined,
    };
    const sdk = {
        light: lightClient,
        explorer: explorer === null ? undefined : {
            baseUrl: 'https://explorer.example.test',
            port: 443,
            coin: 'RBTC',
            ...explorer,
        },
    };
    return { calls, registry: { get: () => sdk } };
}

const REQ = { chainId: 'bitcoin-regtest', address: 'rbtc1qexample', tick: 'PEPECREATURE' };

describe('verifyAddressBalance (§7/§8)', () => {
    it('maps a verified proof to status=verified with the proven amount + height', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: true, amount: '5.5', height: 120, reason: null }),
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res).toEqual({ status: 'verified', amount: '5.5', height: 120, reason: null });
    });

    it('maps a proof-vs-amount contradiction to status=failed (the security alarm)', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: false, reason: 'LEAF_AMOUNT_MISMATCH', height: 120 }),
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.status).toBe('failed');
        expect(res.reason).toBe('LEAF_AMOUNT_MISMATCH');
        expect(res.amount).toBeNull();
    });

    it('degrades a pre-commitment checkpoint to unavailable, not failed', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: false, reason: 'CHECKPOINT_PRE_COMMITMENT' }),
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.status).toBe('unavailable');
        expect(res.reason).toBe('CHECKPOINT_PRE_COMMITMENT');
    });

    it('treats a quorum failure as unavailable (convenience path may serve an incomplete set)', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: false, reason: 'CHECKPOINT_QUORUM_FAILED' }),
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.status).toBe('unavailable');
    });

    it('never throws on a transport error; resolves to unavailable carrying the message', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => { throw new Error('LightClient: explorer returned HTTP 503'); },
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.status).toBe('unavailable');
        expect(res.reason).toContain('503');
    });

    it('tags an explorer 409 as NOT_YET_CHECKPOINTED', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => { throw new Error('LightClient: explorer returned HTTP 409'); },
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.status).toBe('unavailable');
        expect(res.reason).toBe('NOT_YET_CHECKPOINTED');
    });

    it('reports SPV_UNSUPPORTED when the SDK has no light client', async () => {
        const { registry } = makeRegistry({ light: null });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res).toEqual({ status: 'unavailable', amount: null, height: null, reason: 'SPV_UNSUPPORTED' });
    });

    it('passes the SDK explorer URL + coin through to the light client', async () => {
        const { registry, calls } = makeRegistry({
            verifyBalance: () => ({ verified: true, amount: '1', height: 1 }),
        });
        await verifyAddressBalance({ sdkRegistry: registry, ...REQ, atHeight: 99 });
        expect(calls[0][0]).toBe('balance');
        expect(calls[0][1]).toMatchObject({
            explorerUrl: 'https://explorer.example.test',
            coin: 'RBTC',
            address: REQ.address,
            tick: REQ.tick,
            atHeight: 99,
        });
    });

    it('synthesizes an http:// URL with the port when baseUrl lacks a scheme', async () => {
        const { registry, calls } = makeRegistry({
            verifyBalance: () => ({ verified: true, amount: '1', height: 1 }),
            explorer: { baseUrl: 'localhost', port: 24080, coin: 'RBTC' },
        });
        await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(calls[0][1].explorerUrl).toBe('http://localhost:24080');
    });

    it('rejects up front on missing required args (caller bug, not a verdict)', async () => {
        const { registry } = makeRegistry({ verifyBalance: () => ({ verified: true }) });
        await expect(verifyAddressBalance({ sdkRegistry: registry, chainId: 'x', address: 'a' }))
            .rejects.toThrow(/tick is required/);
    });
});

describe('verifyAddressAction (§7/§8)', () => {
    it('maps a verified action proof to status=verified', async () => {
        const { registry } = makeRegistry({
            verifyAction: () => ({ verified: true, height: 200, reason: null }),
        });
        const res = await verifyAddressAction({ sdkRegistry: registry, chainId: REQ.chainId, actionIndex: 42 });
        expect(res.status).toBe('verified');
        expect(res.height).toBe(200);
    });

    it('maps a merkle-proof mismatch to failed', async () => {
        const { registry } = makeRegistry({
            verifyAction: () => ({ verified: false, reason: 'MERKLE_PROOF_INVALID' }),
        });
        const res = await verifyAddressAction({ sdkRegistry: registry, chainId: REQ.chainId, actionIndex: 42 });
        expect(res.status).toBe('failed');
    });

    it('reports SPV_UNSUPPORTED when the light client lacks verifyAction', async () => {
        const { registry } = makeRegistry({ verifyBalance: () => ({ verified: true }) });
        const res = await verifyAddressAction({ sdkRegistry: registry, chainId: REQ.chainId, actionIndex: 42 });
        expect(res.reason).toBe('SPV_UNSUPPORTED');
    });
});
