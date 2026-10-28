// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: panic mode at scale. With many wallets, a long queue of signed sends,
// many open approval requests and many connected sites, a freeze refuses every
// pending sign and broadcast for as long as it holds, applies in bounded time,
// and lifting it sends nothing until each send is asked for again. A store
// that refuses a write partway through, or a network that drops mid-queue,
// leaves nothing sent while the freeze holds.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
    __resetPanicModePersistenceForTests,
    activatePanicMode,
    assertSigningAllowed,
    clearPanicModeState,
    configurePanicModePersistence,
    deactivatePanicMode,
    getPanicModeSaveStatus,
    isSigningFrozen,
    PANIC_SAVE_CLEAR_FAILED,
    PANIC_SAVE_UNSAVED,
    PanicModeActiveError,
} from '../../../packages/core/src/flows/panicMode.js';
import { drainQueuedBroadcast } from '../../../packages/core/src/flows/queuedBroadcast.js';
import { signMessageFlow } from '../../../packages/core/src/flows/signFlows.js';
import { PanicModeRow } from '../../../packages/core/src/shared/components/settings/PanicModeRow.jsx';
import { PanicSaveNotice } from '../../../packages/core/src/shared/components/settings/PanicSaveNotice.jsx';

const WALLETS = 50;
const QUEUED = 100;
const APPROVALS = 50;
const SITES = 200;

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        delete: async (id) => m.delete(id),
        _map: m,
    };
}

function walletName(i) {
    return `Long-term savings wallet number ${i} kept for the family trust and never spent`;
}

function queuedRecords() {
    return Array.from({ length: QUEUED }, (_, i) => ({
        schemaVersion: 1,
        id: `ptx-${i}`,
        walletId: `wallet-${i % WALLETS}`,
        chain: 'bitcoin',
        network: 'regtest',
        fromAddress: `from-${i}`,
        toAddress: `to-${i}`,
        action: 'SEND',
        actionSummary: `Send ${i + 1} sats from ${walletName(i % WALLETS)}`,
        psbtHex: 'aa',
        txHex: `deadbeef${i.toString(16).padStart(4, '0')}`,
        txid: null,
        status: 'queued',
        createdAt: new Date().toISOString(),
        broadcastAt: null,
        confirmedAt: null,
        rbfReplacement: null,
        error: null,
    }));
}

const chainRegistry = {
    chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? 'bitcoin-regtest' : null),
    get: () => ({ networkKind: 'regtest' }),
};

function sdkWith(broadcastTx) {
    return { get: () => ({ encoder: { broadcastTx } }) };
}

function approvalRequests() {
    return Array.from({ length: APPROVALS }, (_, i) => ({
        id: `approval-${i}`,
        origin: `https://site-${i % SITES}.example`,
        walletId: `wallet-${i % WALLETS}`,
        message: `Sign in request ${i}`,
    }));
}

const connectedSites = Array.from({ length: SITES }, (_, i) => `https://site-${i}.example`);

function store({ refuseSaveAt = 0, refuseClear = false } = {}) {
    let value = null;
    let saves = 0;
    return {
        load: async () => value,
        save: async (s) => {
            saves += 1;
            if (refuseSaveAt && saves >= refuseSaveAt) throw new Error('QUOTA_BYTES quota exceeded');
            value = s;
        },
        clear: async () => { if (refuseClear) throw new Error('write failed'); value = null; },
        get saves() { return saves; },
    };
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
    localStorage.clear();
    __resetPanicModePersistenceForTests();
});

afterEach(() => {
    cleanup();
    clearPanicModeState();
    __resetPanicModePersistenceForTests();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('panic mode at scale: sign and broadcast refusals', () => {
    it('refuses all 100 queued sends and 50 approval signs, leaving every record queued', async () => {
        const pendingTxs = memCollection(queuedRecords());
        const broadcastTx = vi.fn(async () => ({ txid: 'ff'.repeat(32) }));
        const signMessage = vi.fn(async () => 'sig');
        expect(connectedSites).toHaveLength(SITES);

        activatePanicMode();

        const drains = await Promise.allSettled(
            queuedRecords().map((r) => drainQueuedBroadcast({
                vault: { pendingTxs }, sdkRegistry: sdkWith(broadcastTx), chainRegistry, pendingTxId: r.id,
            })),
        );
        const signs = await Promise.allSettled(approvalRequests().map((req) => signMessageFlow({
            vault: {}, walletId: req.walletId, chainRegistry, sdkRegistry: sdkWith(broadcastTx),
            chainId: 'bitcoin-regtest', path: "m/84'/1'/0'/0/0", message: req.message,
            signer: { signMessage },
        })));

        expect(drains.every((d) => d.status === 'rejected' && d.reason instanceof PanicModeActiveError)).toBe(true);
        expect(signs.every((s) => s.status === 'rejected' && s.reason instanceof PanicModeActiveError)).toBe(true);
        expect(broadcastTx).not.toHaveBeenCalled();
        expect(signMessage).not.toHaveBeenCalled();
        for (const rec of pendingTxs._map.values()) expect(rec.status).toBe('queued');
    });

    it('applies the freeze in bounded time and holds it across repeated passes over the queue', async () => {
        const pendingTxs = memCollection(queuedRecords());
        const broadcastTx = vi.fn(async () => ({ txid: 'ff'.repeat(32) }));
        const started = performance.now();
        activatePanicMode();
        expect(() => assertSigningAllowed()).toThrow(PanicModeActiveError);
        expect(performance.now() - started).toBeLessThan(50);

        for (let pass = 0; pass < 5; pass += 1) {
            for (const r of queuedRecords()) {
                await expect(drainQueuedBroadcast({
                    vault: { pendingTxs }, sdkRegistry: sdkWith(broadcastTx), chainRegistry, pendingTxId: r.id,
                })).rejects.toBeInstanceOf(PanicModeActiveError);
            }
        }
        expect(broadcastTx).not.toHaveBeenCalled();
    });

    it('sends nothing on unfreeze until each queued send is asked for again', async () => {
        const pendingTxs = memCollection(queuedRecords());
        const broadcastTx = vi.fn(async () => ({ txid: 'ff'.repeat(32) }));
        activatePanicMode();
        await expect(deactivatePanicMode()).resolves.toBe(true);
        await settle();

        expect(broadcastTx).not.toHaveBeenCalled();
        for (const rec of pendingTxs._map.values()) expect(rec.status).toBe('queued');

        await drainQueuedBroadcast({
            vault: { pendingTxs }, sdkRegistry: sdkWith(broadcastTx), chainRegistry, pendingTxId: 'ptx-7',
        });
        expect(broadcastTx).toHaveBeenCalledOnce();
        expect(pendingTxs._map.get('ptx-7').status).toBe('broadcast');
        expect(pendingTxs._map.get('ptx-8').status).toBe('queued');
    });
});

describe('panic mode at scale: refused writes and network drops', () => {
    it('keeps every send refused when the store refuses a save partway through re-arming 50 wallets', async () => {
        const s = store({ refuseSaveAt: 25 });
        await configurePanicModePersistence(s);
        const pendingTxs = memCollection(queuedRecords());
        const broadcastTx = vi.fn(async () => ({ txid: 'ff'.repeat(32) }));

        for (let i = 0; i < WALLETS; i += 1) {
            activatePanicMode();
            if (i === 24) await settle();
        }
        await settle();
        expect(s.saves).toBe(WALLETS);
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_UNSAVED);
        expect(isSigningFrozen()).toBe(true);

        const drains = await Promise.allSettled(queuedRecords().map((r) => drainQueuedBroadcast({
            vault: { pendingTxs }, sdkRegistry: sdkWith(broadcastTx), chainRegistry, pendingTxId: r.id,
        })));
        expect(drains.every((d) => d.status === 'rejected' && d.reason instanceof PanicModeActiveError)).toBe(true);
        expect(broadcastTx).not.toHaveBeenCalled();
    });

    it('re-queues sends a network drop refused and refuses their retry under a freeze armed mid-queue', async () => {
        const pendingTxs = memCollection(queuedRecords());
        let calls = 0;
        const broadcastTx = vi.fn(async () => {
            calls += 1;
            throw new Error('fetch failed: ECONNRESET');
        });
        const results = [];
        for (const r of queuedRecords()) {
            if (r.id === 'ptx-50') activatePanicMode();
            results.push(await drainQueuedBroadcast({
                vault: { pendingTxs }, sdkRegistry: sdkWith(broadcastTx), chainRegistry, pendingTxId: r.id,
            }).then((v) => v, (e) => e));
        }
        expect(calls).toBe(50);
        expect(results.slice(50).every((e) => e instanceof PanicModeActiveError)).toBe(true);
        for (const rec of pendingTxs._map.values()) expect(rec.status).toBe('queued');

        const retries = await Promise.allSettled(queuedRecords().slice(0, 50).map((r) => drainQueuedBroadcast({
            vault: { pendingTxs }, sdkRegistry: sdkWith(broadcastTx), chainRegistry, pendingTxId: r.id,
        })));
        expect(retries.every((d) => d.status === 'rejected' && d.reason instanceof PanicModeActiveError)).toBe(true);
        expect(calls).toBe(50);
    });

    it('does not send a queued record whose drain is claiming it when the freeze arrives', async () => {
        // The freeze lands while the drain writes its in-flight claim, the
        // moment between the freeze check and the network call.
        const base = memCollection(queuedRecords());
        let armOnClaim = true;
        const pendingTxs = {
            ...base,
            put: async (rec) => {
                if (armOnClaim && rec.status === 'broadcasting') {
                    armOnClaim = false;
                    activatePanicMode();
                }
                return base.put(rec);
            },
        };
        const broadcastTx = vi.fn(async () => ({ txid: 'ff'.repeat(32) }));
        const drain = () => drainQueuedBroadcast({
            vault: { pendingTxs }, sdkRegistry: sdkWith(broadcastTx), chainRegistry, pendingTxId: 'ptx-0',
        });

        await expect(drain()).rejects.toBeInstanceOf(PanicModeActiveError);
        expect(broadcastTx).not.toHaveBeenCalled();
        expect(base._map.get('ptx-0').status).toBe('queued');
        expect(base._map.get('ptx-0').error).toBeNull();

        // The refused drain releases its in-flight claim, so the same record
        // sends exactly once after the freeze lifts.
        await expect(deactivatePanicMode()).resolves.toBe(true);
        const result = await drain();
        expect(result.broadcast).toBe(true);
        expect(broadcastTx).toHaveBeenCalledOnce();
        expect(base._map.get('ptx-0').status).toBe('broadcast');
    });
});

describe('panic mode at scale: Safety row and notice at 360px', () => {
    function Page() {
        return (
            <div style={{ width: 360 }}>
                <PanicSaveNotice />
                {Array.from({ length: WALLETS }, (_, i) => <div key={i}>{walletName(i)}</div>)}
                <PanicModeRow />
            </div>
        );
    }

    it('shows the unsaved notice and a working Deactivate with 50 long wallet names', async () => {
        window.innerWidth = 360;
        await configurePanicModePersistence(store({ refuseSaveAt: 1 }));
        render(<Page />);
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm 24-hour freeze' }));
        await settle();

        expect(screen.getByTestId('panic-save-notice').textContent).toContain("couldn't be saved");
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
        await settle();
        expect(isSigningFrozen()).toBe(false);
        expect(screen.queryByTestId('panic-save-notice')).toBeNull();
        expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy();
    });

    it('keeps the freeze and says so when the clear is refused', async () => {
        window.innerWidth = 360;
        await configurePanicModePersistence(store({ refuseClear: true }));
        render(<Page />);
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm 24-hour freeze' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
        await settle();

        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_CLEAR_FAILED);
        expect(isSigningFrozen()).toBe(true);
        expect(screen.getByTestId('panic-save-notice')).toBeTruthy();
        expect(screen.getByText('Panic mode is active')).toBeTruthy();
    });
});
