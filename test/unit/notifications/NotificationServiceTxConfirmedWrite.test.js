// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// NotificationService: retiring our own pending record is an observation, not
// a notification.
//
// `onTxConfirmed` is the ONLY writer in the wallet that moves a PendingTx off
// 'broadcast'. pendingDeltas subtracts every record still in a committed
// unconfirmed status from spendable balance, so a record nothing ever clears
// is subtracted forever. Sitting that write under `notifications
// .txConfirmations` therefore made a notification preference silently and
// cumulatively understate the balance of anyone who turned it off.
//
// The properties worth pinning are the ones a plausible implementation gets
// wrong: gating the write on the toggle, and, when un-gating it, letting the
// "not one we're tracking" exit collapse into the "toggle off" exit so a
// stranger's transaction gets written too.

import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from '../../../packages/core/src/notifications/NotificationService.js';
import { markPendingTxIndexed } from '../../../packages/core/src/notifications/pendingTxBridge.js';
import { unconfirmedPendingDeltas } from '../../../packages/core/src/flows/pendingDeltas.js';

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
        emit(address, msg) {
            for (const cb of handlers[address] || []) cb(msg);
        },
    };
}

function harness(over = {}) {
    const settings = {
        notifications: {
            txConfirmations: over.txConfirmations !== false,
            incomingReceipts: true,
            dispenserFills: true,
            orderFills: true,
            messages: true,
        },
    };
    const sdk = makeSdk();
    const notify = vi.fn(async () => {});
    const onTxConfirmed = over.onTxConfirmed || vi.fn(async () => {});
    const pending = new Set(over.pending === undefined ? [OUR_TX] : over.pending);
    const svc = new NotificationService({
        getActiveAddresses: async () => [
            { address: 'addrBTC', chainId: 'bitcoin-mainnet', label: 'Bitcoin', network: 'mainnet' },
        ],
        getSdkForChain: () => sdk,
        getSettings: async () => settings,
        notify,
        getPendingTxids: over.noPendingRoster ? undefined : (async () => pending),
        onTxConfirmed,
        logger: { debug() {}, warn() {}, error() {} },
    });
    return { svc, sdk, settings, notify, onTxConfirmed, pending };
}

/** A NEW_ACTION for a send that left OUR address, as the explorer frames it. */
function confirmFrame(over = {}) {
    return {
        type: 'NEW_ACTION',
        data: {
            action_index: 21,
            action: 'SEND',
            source: 'addrBTC',
            destination: 'addrOther',
            tx_hash: OUR_TX,
            ...over,
        },
    };
}

describe('NotificationService: confirming our own send is not a notification', () => {
    it('writes the confirmation with txConfirmations OFF, and raises no notification', async () => {
        // The row. A user who does not want to be told still needs the record
        // cleared, or pendingDeltas keeps netting the send out of their
        // spendable balance for the life of the wallet.
        const h = harness({ txConfirmations: false });
        await h.svc.start();

        h.sdk.emit('addrBTC', confirmFrame());
        await flush();

        expect(h.onTxConfirmed).toHaveBeenCalledTimes(1);
        expect(h.onTxConfirmed).toHaveBeenCalledWith(OUR_TX);
        expect(h.notify).not.toHaveBeenCalled();
    });

    it('writes the confirmation AND notifies with txConfirmations ON', async () => {
        const h = harness();
        await h.svc.start();

        h.sdk.emit('addrBTC', confirmFrame());
        await flush();

        expect(h.onTxConfirmed).toHaveBeenCalledWith(OUR_TX);
        expect(h.notify).toHaveBeenCalledTimes(1);
        expect(h.notify.mock.calls[0][0]).toMatchObject({ kind: 'tx-confirmed' });
    });

    it('writes nothing for a txid we are not tracking, toggle OFF', async () => {
        // Un-gating the write must not un-gate WHOSE transaction gets written.
        const h = harness({ txConfirmations: false });
        await h.svc.start();

        h.sdk.emit('addrBTC', confirmFrame({ tx_hash: STRANGER_TX }));
        await flush();

        expect(h.onTxConfirmed).not.toHaveBeenCalled();
        expect(h.notify).not.toHaveBeenCalled();
    });

    it('writes nothing for a txid we are not tracking, toggle ON', async () => {
        const h = harness();
        await h.svc.start();

        h.sdk.emit('addrBTC', confirmFrame({ tx_hash: STRANGER_TX }));
        await flush();

        expect(h.onTxConfirmed).not.toHaveBeenCalled();
        expect(h.notify).not.toHaveBeenCalled();
    });

    it('writes nothing for an own-source frame carrying no transaction hash', async () => {
        const h = harness({ txConfirmations: false });
        await h.svc.start();

        const frame = confirmFrame();
        delete frame.data.tx_hash;
        h.sdk.emit('addrBTC', frame);
        await flush();

        expect(h.onTxConfirmed).not.toHaveBeenCalled();
    });

    it('writes nothing for an action that did not leave our address', async () => {
        const h = harness({ txConfirmations: false });
        await h.svc.start();

        h.sdk.emit('addrBTC', confirmFrame({ source: 'addrOther', destination: 'addrBTC' }));
        await flush();

        expect(h.onTxConfirmed).not.toHaveBeenCalled();
    });

    it('still writes with no pending roster wired, toggle OFF', async () => {
        // Without a roster the source match is the only evidence there is, and
        // that is the same evidence the notification runs on.
        const h = harness({ txConfirmations: false, noPendingRoster: true });
        await h.svc.start();

        h.sdk.emit('addrBTC', confirmFrame());
        await flush();

        expect(h.onTxConfirmed).toHaveBeenCalledWith(OUR_TX);
        expect(h.notify).not.toHaveBeenCalled();
    });

    it('survives a writer that throws while the toggle is off', async () => {
        const boom = vi.fn(async () => { throw new Error('storage busy'); });
        const h = harness({ txConfirmations: false, onTxConfirmed: boom });
        await h.svc.start();

        h.sdk.emit('addrBTC', confirmFrame());
        await flush();

        expect(boom).toHaveBeenCalledWith(OUR_TX);
        expect(h.notify).not.toHaveBeenCalled();
    });
});

// The reason the row was promoted, driven end to end through the real modules:
// the toggle must not decide what the user is allowed to spend.
describe('a confirmation with notifications off still frees the balance', () => {
    it('stops pendingDeltas netting the send out of spendable balance', async () => {
        const record = {
            id: 'p1',
            txid: OUR_TX,
            status: 'broadcast',
            action: 'SEND',
            chain: 'BTC',
            network: 'mainnet',
            fromAddress: 'addrBTC',
            toAddress: 'addrOther',
            tick: 'PEPECREATURE',
            amount: '25',
            confirmedAt: null,
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
        const venue = { coin: 'BTC', network: 'mainnet', source: 'addrBTC' };

        // Before the confirmation lands, the whole send is held back.
        expect(unconfirmedPendingDeltas(store, venue)).toEqual([
            { tick: 'PEPECREATURE', amount: '25' },
        ]);

        // Notifications off, and the real writer wired the way the shells wire it.
        const h = harness({
            txConfirmations: false,
            onTxConfirmed: (txid) => markPendingTxIndexed(vault, txid, {
                now: () => '2026-08-27T12:05:00.000Z',
            }),
        });
        await h.svc.start();
        h.sdk.emit('addrBTC', confirmFrame());
        await flush();

        expect(store[0].status).toBe('indexed');
        expect(unconfirmedPendingDeltas(store, venue)).toEqual([]);
        expect(h.notify).not.toHaveBeenCalled();
    });
});
