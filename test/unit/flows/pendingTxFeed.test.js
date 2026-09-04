// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the M2.1 read paths: this wallet's own in-flight sends
// (`livePendingTxs`) and the unconfirmed explorer rows (`addressMempool`).

import { describe, it, expect } from 'vitest';
import { livePendingTxs } from '../../../packages/core/src/flows/pendingTxFeed.js';
import { addressMempool } from '../../../packages/core/src/flows/balances.js';

const CHAIN_ID = 'litecoin-regtest';
const OURS = 'mtkx2FQownAddress';

function record(over = {}) {
    return {
        id: 'ptx-1',
        chain: 'LTC',
        network: 'regtest',
        fromAddress: OURS,
        toAddress: 'moV6MFmTheirs',
        action: 'SEND',
        actionSummary: 'Send 100 XCHAIN',
        psbtHex: 'deadbeef'.repeat(64),
        txHex: 'cafebabe'.repeat(64),
        txid: 'AABBCC',
        status: 'broadcast',
        createdAt: '2026-08-27T00:00:00.000Z',
        broadcastAt: '2026-08-27T00:00:10.000Z',
        confirmedAt: null,
        rbfReplacement: null,
        error: null,
        tick: 'XCHAIN',
        amount: '100',
        ...over,
    };
}

const vaultOf = (records) => ({ pendingTxs: { list: async () => records } });
const registry = { get: () => ({ coin: 'LTC', networkKind: 'regtest' }) };

describe('livePendingTxs', () => {
    it('returns the sends that are on the network and not yet confirmed', async () => {
        const out = await livePendingTxs({
            vault: vaultOf([record()]), chainRegistry: registry, chainId: CHAIN_ID,
        });
        expect(out).toHaveLength(1);
        expect(out[0].txid).toBe('AABBCC');
    });

    it('never lets transaction material cross the messaging boundary', async () => {
        const out = await livePendingTxs({
            vault: vaultOf([record()]), chainRegistry: registry, chainId: CHAIN_ID,
        });
        expect(out[0]).not.toHaveProperty('psbtHex');
        expect(out[0]).not.toHaveProperty('txHex');
        expect(JSON.stringify(out)).not.toContain('deadbeef');
        expect(JSON.stringify(out)).not.toContain('cafebabe');
    });

    it('excludes records that never reached the network or already confirmed', async () => {
        const excluded = ['composing', 'awaiting-signature', 'signed', 'queued', 'indexed', 'failed'];
        for (const status of excluded) {
            const out = await livePendingTxs({
                vault: vaultOf([record({ status })]), chainRegistry: registry, chainId: CHAIN_ID,
            });
            expect(out, status).toHaveLength(0);
        }
    });

    it('excludes a record with no txid: History has nothing to merge it on', async () => {
        const out = await livePendingTxs({
            vault: vaultOf([record({ txid: null })]), chainRegistry: registry, chainId: CHAIN_ID,
        });
        expect(out).toHaveLength(0);
    });

    it('keeps a replaced record so the superseded entry can say so', async () => {
        const out = await livePendingTxs({
            vault: vaultOf([record({ status: 'rbf-replaced', rbfReplacement: 'FFEEDD' })]),
            chainRegistry: registry,
            chainId: CHAIN_ID,
        });
        expect(out[0].rbfReplacement).toBe('FFEEDD');
    });

    it('does not leak another network\'s pending send onto this chain', async () => {
        const out = await livePendingTxs({
            vault: vaultOf([record({ network: 'mainnet' })]),
            chainRegistry: registry,
            chainId: CHAIN_ID,
        });
        expect(out).toHaveLength(0);
    });

    it('does not leak another coin\'s pending send onto this chain', async () => {
        const out = await livePendingTxs({
            vault: vaultOf([record({ chain: 'DOGE' })]),
            chainRegistry: registry,
            chainId: CHAIN_ID,
        });
        expect(out).toHaveLength(0);
    });

    it('matches on chain id alone for a chain the registry cannot resolve', async () => {
        const out = await livePendingTxs({
            vault: vaultOf([record({ chain: 'custom-chain' })]),
            chainRegistry: { get: () => null },
            chainId: 'custom-chain',
        });
        expect(out).toHaveLength(1);
    });

    it('restricts to one address when asked, case-insensitively', async () => {
        const vault = vaultOf([record(), record({ id: 'ptx-2', fromAddress: 'someoneElse' })]);
        const out = await livePendingTxs({
            vault, chainRegistry: registry, chainId: CHAIN_ID, address: OURS.toUpperCase(),
        });
        expect(out.map((r) => r.id)).toEqual(['ptx-1']);
    });

    it('passes through the network-sighting field M2.2 records', async () => {
        const out = await livePendingTxs({
            vault: vaultOf([record({ mempoolSeenAt: '2026-08-27T00:01:00.000Z' })]),
            chainRegistry: registry,
            chainId: CHAIN_ID,
        });
        expect(out[0].mempoolSeenAt).toBe('2026-08-27T00:01:00.000Z');
    });

    it('reports null rather than undefined on a record that predates M2.2', async () => {
        const { mempoolSeenAt: _drop, ...v2 } = record();
        const out = await livePendingTxs({
            vault: vaultOf([v2]), chainRegistry: registry, chainId: CHAIN_ID,
        });
        expect(out[0].mempoolSeenAt).toBeNull();
    });

    it('requires a vault and a chain', async () => {
        await expect(livePendingTxs({ chainId: CHAIN_ID })).rejects.toThrow(/vault is required/);
        await expect(livePendingTxs({ vault: vaultOf([]) })).rejects.toThrow(/chainId is required/);
    });
});

describe('addressMempool', () => {
    const rows = [{ tx_hash: 'aabbcc', source: 's', action: 'SEND', data: 'd', first_seen: 1 }];

    it('returns the SDK\'s unconfirmed rows verbatim', async () => {
        const sdkRegistry = { get: () => ({ getUnconfirmed: async () => rows }) };
        expect(await addressMempool({ sdkRegistry, chainId: CHAIN_ID, address: OURS })).toEqual(rows);
    });

    it('passes options through to the SDK', async () => {
        let seen = null;
        const sdkRegistry = {
            get: () => ({ getUnconfirmed: async (addr, opts) => { seen = { addr, opts }; return []; } }),
        };
        await addressMempool({ sdkRegistry, chainId: CHAIN_ID, address: OURS, opts: { limit: 25 } });
        expect(seen).toEqual({ addr: OURS, opts: { limit: 25 } });
    });

    it('degrades to no rows against an SDK without the unconfirmed surface', async () => {
        const sdkRegistry = { get: () => ({}) };
        expect(await addressMempool({ sdkRegistry, chainId: CHAIN_ID, address: OURS })).toEqual([]);
    });

    it('degrades to no rows when the chain has no SDK at all', async () => {
        const sdkRegistry = { get: () => null };
        expect(await addressMempool({ sdkRegistry, chainId: CHAIN_ID, address: OURS })).toEqual([]);
    });

    it('requires its arguments', async () => {
        const sdkRegistry = { get: () => ({}) };
        await expect(addressMempool({ chainId: CHAIN_ID, address: OURS }))
            .rejects.toThrow(/sdkRegistry is required/);
        await expect(addressMempool({ sdkRegistry, address: OURS }))
            .rejects.toThrow(/chainId is required/);
        await expect(addressMempool({ sdkRegistry, chainId: CHAIN_ID }))
            .rejects.toThrow(/address is required/);
    });
});
