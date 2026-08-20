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
function makeRegistry({ light, verifyBalance, verifyAction, explorer, getPinnedCheckpoint } = {}) {
    const calls = [];
    const lightClient = light === null ? undefined : {
        verifyBalance: verifyBalance
            ? async (opts) => { calls.push(['balance', opts]); return verifyBalance(opts); }
            : undefined,
        verifyAction: verifyAction
            ? async (opts) => { calls.push(['action', opts]); return verifyAction(opts); }
            : undefined,
        // Present only when a test opts in, so the default registry models an
        // SDK old enough to predate the accessor: the explorer tier.
        ...(getPinnedCheckpoint ? { getPinnedCheckpoint } : {}),
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
        expect(res).toEqual({ status: 'verified', amount: '5.5', height: 120, reason: null, trust: 'explorer' });
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
        expect(res).toEqual({ status: 'unavailable', amount: null, height: null, reason: 'SPV_UNSUPPORTED', trust: 'explorer' });
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

    it('binds the proof to the requested identity (`expected` rides every call)', async () => {
        const { registry, calls } = makeRegistry({
            verifyBalance: () => ({ verified: true, amount: '1', height: 1 }),
        });
        await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        // The wallet asks for exactly the (address, tick) it queried, so a
        // genuine proof for a different key refuses rather than verifying.
        expect(calls[0][1].expected).toEqual({ address: REQ.address, tick: REQ.tick });
    });

    it('maps a requested-identity mismatch to failed (the server substituted its answer)', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: false, reason: 'REQUESTED_IDENTITY_MISMATCH', height: 120 }),
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.status).toBe('failed');
        expect(res.reason).toBe('REQUESTED_IDENTITY_MISMATCH');
    });

    it('maps a balance-query mismatch to failed (proof proves a different key)', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: false, reason: 'BALANCE_QUERY_MISMATCH', height: 120 }),
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.status).toBe('failed');
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

    it('binds the proof to the requested action index (`expected` rides every call)', async () => {
        const { registry, calls } = makeRegistry({
            verifyAction: () => ({ verified: true, height: 200, reason: null }),
        });
        await verifyAddressAction({ sdkRegistry: registry, chainId: REQ.chainId, actionIndex: 42 });
        expect(calls[0][1].expected).toEqual({ action_index: '42' });
    });

    it('maps a requested-identity mismatch on an action proof to failed', async () => {
        const { registry } = makeRegistry({
            verifyAction: () => ({ verified: false, reason: 'REQUESTED_IDENTITY_MISMATCH' }),
        });
        const res = await verifyAddressAction({ sdkRegistry: registry, chainId: REQ.chainId, actionIndex: 42 });
        expect(res.status).toBe('failed');
    });
});

// The pinned launch trust root (SPV spec D4). The tier is what makes a quorum
// failure legible: with no pin the explorer picked the validator set and a miss
// is ordinary degraded service, while with a pin the explorer served a
// checkpoint outside the root we brought ourselves.
describe('pinned trust root (SPV D4)', () => {
    const PIN = { checkpoint: { block_index: 961000, state_root: 'ab'.repeat(32) }, validators: [{ pubkey: 'aa', weight: '100', source: 'aa' }] };

    it('reports trust=explorer when nothing is pinned for the coin', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: true, amount: '1', height: 10 }),
            getPinnedCheckpoint: () => null,
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.trust).toBe('explorer');
    });

    it('reports trust=pinned when the SDK registry pins this coin', async () => {
        const seen = [];
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: true, amount: '1', height: 10 }),
            getPinnedCheckpoint: (coin) => { seen.push(coin); return PIN; },
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.trust).toBe('pinned');
        expect(seen).toEqual(['RBTC']);
    });

    it('escalates a quorum failure to failed on the pinned tier (checkpoint outside our root)', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: false, reason: 'CHECKPOINT_QUORUM_FAILED', height: 10 }),
            getPinnedCheckpoint: () => PIN,
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.status).toBe('failed');
        expect(res.reason).toBe('CHECKPOINT_QUORUM_FAILED');
        expect(res.trust).toBe('pinned');
    });

    it('leaves the same quorum failure at unavailable on the explorer tier', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: false, reason: 'CHECKPOINT_QUORUM_FAILED', height: 10 }),
            getPinnedCheckpoint: () => null,
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.status).toBe('unavailable');
    });

    it('does not escalate a pre-commitment checkpoint even when pinned', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: false, reason: 'CHECKPOINT_PRE_COMMITMENT' }),
            getPinnedCheckpoint: () => PIN,
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.status).toBe('unavailable');
        expect(res.trust).toBe('pinned');
    });

    it('escalates the pinned quorum failure on the action path too', async () => {
        const { registry } = makeRegistry({
            verifyAction: () => ({ verified: false, reason: 'CHECKPOINT_QUORUM_FAILED' }),
            getPinnedCheckpoint: () => PIN,
        });
        const res = await verifyAddressAction({ sdkRegistry: registry, chainId: REQ.chainId, actionIndex: 7 });
        expect(res.status).toBe('failed');
        expect(res.trust).toBe('pinned');
    });

    it('forwards a caller-supplied resolver to the light client and trusts its answer', async () => {
        const { registry, calls } = makeRegistry({
            verifyBalance: () => ({ verified: true, amount: '1', height: 10 }),
            getPinnedCheckpoint: () => null,
        });
        const mine = () => PIN;
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ, pinnedResolver: mine });
        expect(res.trust).toBe('pinned');
        expect(calls[0][1].pinnedResolver).toBe(mine);
    });

    it('does not forward a resolver when relying on the SDK registry (one copy, no drift)', async () => {
        const { registry, calls } = makeRegistry({
            verifyBalance: () => ({ verified: true, amount: '1', height: 10 }),
            getPinnedCheckpoint: () => PIN,
        });
        await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(calls[0][1].pinnedResolver).toBeUndefined();
    });

    it('falls back to the explorer tier when a resolver throws (a broken pin is not a trust root)', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: false, reason: 'CHECKPOINT_QUORUM_FAILED' }),
            getPinnedCheckpoint: () => { throw new Error('registry blew up'); },
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.trust).toBe('explorer');
        expect(res.status).toBe('unavailable');
    });

    it('reports the explorer tier against an SDK too old to expose the registry', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => ({ verified: true, amount: '1', height: 10 }),
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.trust).toBe('explorer');
    });

    it('carries the tier on a transport failure so a caller never sees trust undefined', async () => {
        const { registry } = makeRegistry({
            verifyBalance: () => { throw new Error('LightClient: explorer returned HTTP 503'); },
            getPinnedCheckpoint: () => PIN,
        });
        const res = await verifyAddressBalance({ sdkRegistry: registry, ...REQ });
        expect(res.trust).toBe('pinned');
        expect(res.status).toBe('unavailable');
    });
});
