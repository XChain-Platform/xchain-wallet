// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.


import { describe, it, expect, vi } from 'vitest';
import { drainQueuedBroadcast } from '../../../packages/core/src/flows/queuedBroadcast.js';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';
import {
    assertMainnetActionAllowed, MainnetPrelaunchError, MAINNET_LAUNCH_EPOCH,
} from '../../../packages/core/src/flows/mainnetPrelaunch.js';

const DESCRIPTOR = { id: 'bitcoin-mainnet', coin: 'bitcoin', networkKind: 'mainnet' };
const BEFORE = (MAINNET_LAUNCH_EPOCH - 1) * 1000;
const AT = MAINNET_LAUNCH_EPOCH * 1000;
const BARE = { action: 'SEND', params: { TICK: 'BTC', AMOUNT: '0.5', DESTINATION: 'bc1qdest' } };
const TOKEN = { action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'bc1qdest' } };

describe('assertMainnetActionAllowed', () => {
    it('refuses an XChain action on a mainnet chain before launch', () => {
        expect(() => assertMainnetActionAllowed({ chainId: 'bitcoin-mainnet', actionData: TOKEN, descriptor: DESCRIPTOR, now: BEFORE }))
            .toThrow(MainnetPrelaunchError);
    });
    it('allows a bare native payment', () => {
        expect(() => assertMainnetActionAllowed({ chainId: 'bitcoin-mainnet', actionData: BARE, descriptor: DESCRIPTOR, now: BEFORE })).not.toThrow();
    });
    it('allows everything at and after the launch instant', () => {
        expect(() => assertMainnetActionAllowed({ chainId: 'bitcoin-mainnet', actionData: TOKEN, descriptor: DESCRIPTOR, now: AT })).not.toThrow();
    });
    it('ignores non-mainnet chains', () => {
        expect(() => assertMainnetActionAllowed({ chainId: 'bitcoin-regtest', actionData: TOKEN, descriptor: DESCRIPTOR, now: BEFORE })).not.toThrow();
    });
});

describe('submitWithSigner on mainnet before launch', () => {
    it('refuses a token action before touching the SDK encoder', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(BEFORE);
        try {
            const createTx = vi.fn();
            const signer = { kind: 'software', signPsbt: vi.fn() };
            await expect(submitWithSigner({
                sdkRegistry: { get: () => ({ encoder: { createTx }, actions: {} }) },
                chainRegistry: { get: () => DESCRIPTOR },
                chainId: 'bitcoin-mainnet',
                actionData: TOKEN,
                encoderOpts: { pubkey: 'pub' },
                signer,
                signingPaths: [{ inputIndex: 0, path: 'm/0' }],
            })).rejects.toBeInstanceOf(MainnetPrelaunchError);
            expect(createTx).not.toHaveBeenCalled();
            expect(signer.signPsbt).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('drainQueuedBroadcast on mainnet before launch', () => {
    function setup(params) {
        const rec = {
            id: 'ptx-m', chain: 'bitcoin', network: 'mainnet', action: 'SEND',
            params, txHex: 'deadbeef', status: 'queued', error: null,
        };
        const store = new Map([[rec.id, rec]]);
        const vault = { pendingTxs: {
            get: async (id) => store.get(id) ?? null,
            put: async (r) => { store.set(r.id, { ...r }); },
        } };
        const broadcastTx = vi.fn(async () => ({ txid: 'tx' }));
        return {
            store, broadcastTx, vault,
            args: {
                vault,
                sdkRegistry: { get: () => ({ encoder: { broadcastTx } }) },
                chainRegistry: { chainIdFor: () => 'bitcoin-mainnet', get: () => DESCRIPTOR },
                pendingTxId: 'ptx-m',
            },
        };
    }

    it('keeps a queued token action queued and never broadcasts', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(BEFORE);
        try {
            const t = setup(TOKEN.params);
            await expect(drainQueuedBroadcast(t.args)).rejects.toBeInstanceOf(MainnetPrelaunchError);
            expect(t.broadcastTx).not.toHaveBeenCalled();
            expect(t.store.get('ptx-m').status).toBe('queued');
        } finally {
            vi.useRealTimers();
        }
    });

    it('still broadcasts a queued bare native payment', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(BEFORE);
        try {
            const t = setup(BARE.params);
            const r = await drainQueuedBroadcast(t.args);
            expect(r.broadcast).toBe(true);
            expect(t.broadcastTx).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('broadcasts a queued token action at launch', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(AT);
        try {
            const t = setup(TOKEN.params);
            const r = await drainQueuedBroadcast(t.args);
            expect(r.broadcast).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
