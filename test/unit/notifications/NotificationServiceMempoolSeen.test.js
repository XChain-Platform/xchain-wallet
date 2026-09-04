// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// NotificationService: the MEMPOOL_ACTION observation hook (§4 M2.2).
//
// This is the half of M2.2 that makes the other half true. The timeline can
// only stop claiming "in mempool" off zero evidence if SOMETHING records the
// evidence when it arrives, and the wallet already holds exactly one WS
// subscription per address that MEMPOOL_ACTION frames ride on (M1.2 put them
// in the SDK's ADDRESS_EVENT_TYPES roster). So the observation attaches to the
// existing handler and opens no second subscription: the explorer caps a
// connection at 25.
//
// The properties worth pinning are the ones a plausible implementation gets
// wrong: stamping a stranger's transaction, opening a second subscription,
// and letting a notification toggle decide whether the wallet is allowed to
// know where its own transaction is.

import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from '../../../packages/core/src/notifications/NotificationService.js';
import { markPendingTxMempoolSeen } from '../../../packages/core/src/notifications/pendingTxBridge.js';
import {
    pendingTxToEntry,
    pendingDisplayState,
} from '../../../packages/core/src/shared/utils/pendingHistory.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

const OUR_TX = 'aa11bb22cc33dd44ee55ff6600771122334455667788990011223344556677889';
const STRANGER_TX = 'ff99ee88dd77cc66bb55aa4433221100ffeeddccbbaa99887766554433221100f';

function makeSdk() {
    /** @type {Record<string, Function[]>} */
    const handlers = {};
    return {
        connectWs: vi.fn(async () => {}),
        disconnectWs: vi.fn(() => {}),
        onAddress: vi.fn((address, cb) => {
            (handlers[address] = handlers[address] || []).push(cb);
            return () => {
                handlers[address] = (handlers[address] || []).filter((h) => h !== cb);
            };
        }),
        // Present so a test can prove we did NOT reach for it. M1.2 shares one
        // refcounted address-channel subscription between onAddress and
        // onMempoolAction, so calling both here would add a second holder of
        // the identical subscription for no delivery we do not already get.
        onMempoolAction: vi.fn(() => () => {}),
        emit(address, msg) {
            for (const cb of handlers[address] || []) cb(msg);
        },
    };
}

function harness(over = {}) {
    const settings = {
        notifications: {
            txConfirmations: true,
            incomingReceipts: true,
            dispenserFills: true,
            orderFills: true,
            messages: true,
        },
        ...over.settings,
    };
    const sdk = makeSdk();
    const addresses = [
        { address: 'addrBTC', chainId: 'bitcoin-mainnet', label: 'Bitcoin', network: 'mainnet' },
    ];
    const onMempoolSeen = vi.fn(async () => {});
    const onTxConfirmed = vi.fn(async () => {});
    const pending = new Set(over.pending === undefined ? [OUR_TX] : over.pending);
    const svc = new NotificationService({
        getActiveAddresses: async () => addresses,
        getSdkForChain: () => sdk,
        getSettings: over.getSettings || (async () => settings),
        notify: vi.fn(async () => {}),
        getPendingTxids: over.noPendingRoster ? undefined : (async () => pending),
        onTxConfirmed,
        onMempoolSeen: over.noHook ? undefined : onMempoolSeen,
        logger: { debug() {}, warn() {}, error() {} },
    });
    return { svc, sdk, settings, addresses, onMempoolSeen, onTxConfirmed, pending };
}

/** A MEMPOOL_ACTION exactly as the explorer frames it (M1.1 field set). */
function mempoolFrame(over = {}) {
    return {
        type: 'MEMPOOL_ACTION',
        data: {
            tx_hash: OUR_TX,
            source: 'addrBTC',
            action: 'SEND',
            data: 'SEND|0|PEPECREATURE|1|addrOther',
            first_seen: 1787875200,
            destinations: ['addrOther'],
            ...over,
        },
    };
}

describe('NotificationService: mempool sighting of our own transaction', () => {
    it('records the sighting when a MEMPOOL_ACTION names one of our pending txids', async () => {
        const h = harness();
        await h.svc.start();

        h.sdk.emit('addrBTC', mempoolFrame());
        await flush();

        expect(h.onMempoolSeen).toHaveBeenCalledTimes(1);
        expect(h.onMempoolSeen).toHaveBeenCalledWith(OUR_TX);
    });

    it('rides the EXISTING address subscription: no second subscription per address', async () => {
        const h = harness();
        await h.svc.start();

        expect(h.sdk.onAddress).toHaveBeenCalledTimes(1);
        expect(h.sdk.onMempoolAction).not.toHaveBeenCalled();
    });

    it('ignores a mempool frame for a transaction that is not ours', async () => {
        const h = harness();
        await h.svc.start();

        h.sdk.emit('addrBTC', mempoolFrame({ tx_hash: STRANGER_TX, source: 'addrOther' }));
        await flush();

        expect(h.onMempoolSeen).not.toHaveBeenCalled();
    });

    it('stays silent without a pending roster rather than stamping every frame', async () => {
        // With no roster we cannot tell our own send from a stranger's, and a
        // stamp on a record we do not own is worse than no stamp at all.
        const h = harness({ noPendingRoster: true });
        await h.svc.start();

        h.sdk.emit('addrBTC', mempoolFrame());
        await flush();

        expect(h.onMempoolSeen).not.toHaveBeenCalled();
    });

    it('ignores a frame with no transaction hash', async () => {
        const h = harness();
        await h.svc.start();

        const frame = mempoolFrame();
        delete frame.data.tx_hash;
        h.sdk.emit('addrBTC', frame);
        await flush();

        expect(h.onMempoolSeen).not.toHaveBeenCalled();
    });

    it('records a sighting even with every notification flag off', async () => {
        // Display honesty is not a notification. A user who turned tx
        // notifications off still gets a timeline that says where their
        // transaction actually is.
        const h = harness({ settings: { notifications: {} } });
        await h.svc.start();

        h.sdk.emit('addrBTC', mempoolFrame());
        await flush();

        expect(h.onMempoolSeen).toHaveBeenCalledWith(OUR_TX);
    });

    it('records a sighting even when settings cannot be read at all', async () => {
        const h = harness({ getSettings: async () => { throw new Error('vault locked'); } });
        await h.svc.start();

        h.sdk.emit('addrBTC', mempoolFrame());
        await flush();

        expect(h.onMempoolSeen).toHaveBeenCalledWith(OUR_TX);
    });

    it('records a sighting from a catch-up replay: a replayed frame is still evidence', async () => {
        const h = harness();
        await h.svc.start();

        h.sdk.emit('addrBTC', { ...mempoolFrame(), catch_up: true });
        await flush();

        expect(h.onMempoolSeen).toHaveBeenCalledWith(OUR_TX);
    });

    it('does not treat a mempool sighting as a confirmation', async () => {
        // The indexer can still reject the action (§7). Nothing here may reach
        // for the machinery that flips a record to indexed.
        const h = harness();
        const notify = vi.fn(async () => {});
        h.svc._notify = notify;
        await h.svc.start();

        h.sdk.emit('addrBTC', mempoolFrame());
        await flush();

        expect(h.onTxConfirmed).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it('survives a writer that throws, and keeps delivering afterwards', async () => {
        const h = harness();
        h.svc._onMempoolSeen = vi.fn(async () => { throw new Error('storage busy'); });
        await h.svc.start();

        h.sdk.emit('addrBTC', mempoolFrame());
        await flush();

        // The NEW_ACTION path still works after the failed write.
        h.sdk.emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { source: 'addrBTC', tx_hash: OUR_TX, action: 'SEND', action_index: 42 },
        });
        await flush();
        expect(h.onTxConfirmed).toHaveBeenCalledWith(OUR_TX);
    });

    it('is inert when the shell wires no hook', async () => {
        const h = harness({ noHook: true });
        await h.svc.start();

        h.sdk.emit('addrBTC', mempoolFrame());
        await flush();
        // Nothing to assert but the absence of a throw: an older shell that
        // has not wired the dep must keep working unchanged.
        expect(h.onMempoolSeen).not.toHaveBeenCalled();
    });

    it('ignores frame types that are not MEMPOOL_ACTION', async () => {
        const h = harness();
        await h.svc.start();

        h.sdk.emit('addrBTC', { type: 'MEMPOOL_REMOVED', data: { tx_hash: OUR_TX } });
        await flush();

        expect(h.onMempoolSeen).not.toHaveBeenCalled();
    });
});

// The whole point of the row, driven end to end through the real modules:
// a frame off the wire has to change what the user is told. Each piece
// passing in isolation is exactly how a seam gets shipped disconnected.
describe('MEMPOOL_ACTION changes what the timeline is allowed to say', () => {
    it('takes a broadcast tx from awaiting-network to seen', async () => {
        const record = {
            id: 'p1',
            txid: OUR_TX,
            status: 'broadcast',
            action: 'SEND',
            fromAddress: 'addrBTC',
            toAddress: 'addrOther',
            broadcastAt: '2026-08-27T12:00:05.000Z',
            mempoolSeenAt: null,
        };
        const store = [record];
        const vault = {
            pendingTxs: {
                async findBy(field, value) {
                    return store.filter((r) => r[field] === value).map((r) => ({ ...r }));
                },
                async put(rec) {
                    const i = store.findIndex((r) => r.id === rec.id);
                    if (i >= 0) store[i] = rec; else store.push(rec);
                },
            },
        };

        const toEntry = () => pendingTxToEntry({
            chainId: 'bitcoin-mainnet',
            address: 'addrBTC',
            pendingTx: store[0],
            ownAddresses: new Set(['addrbtc']),
            observedAtMs: Date.parse('2026-08-27T12:00:05.000Z'),
        });
        // Two minutes after broadcast: inside the 180s window, so the honest
        // reading before any sighting is "we sent it, nobody has said so yet".
        const nowMs = Date.parse('2026-08-27T12:02:05.000Z');
        expect(pendingDisplayState(toEntry(), nowMs)).toBe('awaiting-network');

        const h = harness();
        // The real writer, wired the way the shells wire it.
        h.svc._onMempoolSeen = (txid) => markPendingTxMempoolSeen(vault, txid, {
            now: () => '2026-08-27T12:01:20.000Z',
        });
        await h.svc.start();
        h.sdk.emit('addrBTC', mempoolFrame());
        await flush();

        expect(store[0].mempoolSeenAt).toBe('2026-08-27T12:01:20.000Z');
        expect(pendingDisplayState(toEntry(), nowMs)).toBe('seen');
    });
});
