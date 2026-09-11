// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// NotificationService: the `incoming-pending` kind (§5 M3.1), its flag
// (M3.2) and the one-announcement-per-transaction rule (M3.3).
//
// The frames here are shaped the way the explorer actually sends them after
// M1.1/M1.4: a MEMPOOL_ACTION on the RECIPIENT's channel carries
// `destinations[]` with the subscribed literal, and so does the NEW_ACTION
// that confirms it. The retired singular `destination` never appears on a
// live frame any more, which is exactly why the confirmed-side branch had
// never fired before this work.

import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from '../../../packages/core/src/notifications/NotificationService.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

const OURS = 'addrBTC';
const STRANGER = 'addrStranger';
const TX = 'AbCdEf0123456789';
const HOUR = 60 * 60_000;

function makeSdk() {
    const handlers = {};
    return {
        connectWs: vi.fn(async () => {}),
        disconnectWs: vi.fn(() => {}),
        onAddress: vi.fn((address, cb) => {
            (handlers[address] = handlers[address] || []).push(cb);
            return () => { handlers[address] = (handlers[address] || []).filter((h) => h !== cb); };
        }),
        emit(address, msg) { for (const cb of handlers[address] || []) cb(msg); },
    };
}

function harness({ settings: settingsOverride, now = 1_000_000 } = {}) {
    const settings = {
        notifications: { txConfirmations: true, incomingReceipts: true, messages: true, dispenserFills: true, orderFills: true, priceAlerts: true },
        ...settingsOverride,
    };
    const sdk = makeSdk();
    const notify = vi.fn(async () => {});
    let clock = now;
    const svc = new NotificationService({
        getActiveAddresses: async () => [{ address: OURS, chainId: 'bitcoin-mainnet', label: 'Bitcoin', network: 'mainnet' }],
        getSdkForChain: () => sdk,
        getSettings: async () => settings,
        notify,
        now: () => clock,
    });
    return { svc, sdk, notify, settings, advance: (ms) => { clock += ms; } };
}

/** A MEMPOOL_ACTION as the explorer frames it on the recipient's channel. */
function pendingFrame(over = {}) {
    return {
        type: 'MEMPOOL_ACTION',
        timestamp: Date.now(),
        data: { tx_hash: TX, source: STRANGER, action: 'SEND', data: `SEND|2|XCHAIN|5|${OURS}`, first_seen: 1_700_000_000, destinations: [OURS], ...over },
    };
}

/** The NEW_ACTION that confirms the same transaction, M1.4 shape (no singular `destination`). */
function confirmedFrame(over = {}) {
    return {
        type: 'NEW_ACTION',
        timestamp: Date.now(),
        data: { action_index: 77, tx_hash: TX, source: STRANGER, action: 'SEND', destinations: [OURS], ...over },
    };
}

async function started(opts) {
    const h = harness(opts);
    await h.svc.start();
    return h;
}

describe('NotificationService: incoming-pending', () => {
    it('raises exactly one incoming-pending for a mempool payment to a watched address', async () => {
        const h = await started();
        h.sdk.emit(OURS, pendingFrame());
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(1);
        const n = h.notify.mock.calls[0][0];
        expect(n.kind).toBe('incoming-pending');
        expect(n.data).toMatchObject({ address: OURS, type: 'MEMPOOL_ACTION', txHash: TX.toLowerCase() });
        // Privacy (§46.4): no amount, no counterparty in what the OS shows.
        expect(`${n.title} ${n.body}`).not.toMatch(/5|XCHAIN|addrStranger/);
        expect(`${n.title} ${n.body}`).toMatch(/pending/i);
    });

    it('does not raise it for our OWN send, even when our address is among the destinations', async () => {
        const h = await started();
        // A self-send or a change output: the frame reaches us as the SOURCE.
        h.sdk.emit(OURS, pendingFrame({ source: OURS, destinations: [OURS] }));
        await flush();
        expect(h.notify).not.toHaveBeenCalled();
    });

    it('ignores a mempool frame that names neither side as us', async () => {
        const h = await started();
        h.sdk.emit(OURS, pendingFrame({ destinations: ['addrElse'] }));
        await flush();
        expect(h.notify).not.toHaveBeenCalled();
    });

    it('is silent with the flag off, and ON when the flag is absent from an older settings record', async () => {
        const off = await started({ settings: { notifications: { incomingReceipts: true, incomingPending: false } } });
        off.sdk.emit(OURS, pendingFrame());
        await flush();
        expect(off.notify).not.toHaveBeenCalled();

        const absent = await started();
        expect(absent.settings.notifications.incomingPending).toBeUndefined();
        absent.sdk.emit(OURS, pendingFrame());
        await flush();
        expect(absent.notify).toHaveBeenCalledTimes(1);
    });

    it('never notifies on a catch_up replay, but still only once when the live frame follows', async () => {
        const h = await started();
        h.sdk.emit(OURS, { ...pendingFrame(), catch_up: true });
        await flush();
        expect(h.notify).not.toHaveBeenCalled();
        h.sdk.emit(OURS, pendingFrame());
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(1);
    });

    it('dedups a repeated mempool frame by tx_hash, not by its broadcast-stamped timestamp', async () => {
        const h = await started();
        h.sdk.emit(OURS, pendingFrame({}));
        await flush();
        // Same transaction, a later poll's frame with a fresh timestamp and a
        // different letter case on the hash: still the same event.
        h.sdk.emit(OURS, { ...pendingFrame({ tx_hash: TX.toUpperCase() }), timestamp: Date.now() + 5_000 });
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(1);
    });

    it('quiet hours suppress the pending notice without marking it announced, so the confirmation still speaks', async () => {
        // A fixed 24h window that always contains "now" would be zero-width and
        // never suppress, so build a window around the current local minute.
        const d = new Date();
        const hh = (n) => String(((n % 24) + 24) % 24).padStart(2, '0');
        const quiet = { enabled: true, start: `${hh(d.getHours() - 1)}:00`, end: `${hh(d.getHours() + 2)}:00` };
        const h = await started({ settings: { notifications: { incomingReceipts: true }, quietHours: quiet } });
        h.sdk.emit(OURS, pendingFrame());
        await flush();
        expect(h.notify).not.toHaveBeenCalled();

        h.settings.quietHours.enabled = false;
        h.sdk.emit(OURS, confirmedFrame());
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(1);
        expect(h.notify.mock.calls[0][0].kind).toBe('incoming-receipt');
    });
});

describe('NotificationService: one "received" announcement per transaction', () => {
    it('the confirmation of an already-announced pending payment raises no incoming-receipt', async () => {
        const h = await started();
        h.sdk.emit(OURS, pendingFrame());
        await flush();
        h.advance(5 * 60_000); // well past the 30s replay dedup
        h.sdk.emit(OURS, confirmedFrame());
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(1);
        expect(h.notify.mock.calls[0][0].kind).toBe('incoming-pending');
    });

    it('a late mempool sighting of an already-confirmed payment raises no incoming-pending', async () => {
        const h = await started();
        h.sdk.emit(OURS, confirmedFrame());
        await flush();
        h.advance(60_000);
        h.sdk.emit(OURS, pendingFrame());
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(1);
        expect(h.notify.mock.calls[0][0].kind).toBe('incoming-receipt');
    });

    it('a different transaction to the same address is announced on its own', async () => {
        const h = await started();
        h.sdk.emit(OURS, pendingFrame());
        await flush();
        h.sdk.emit(OURS, pendingFrame({ tx_hash: 'ffff0000' }));
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(2);
    });

    it('forgets an announcement after an hour, so a very late confirmation is not swallowed forever', async () => {
        const h = await started();
        h.sdk.emit(OURS, pendingFrame());
        await flush();
        h.advance(HOUR + 1);
        h.sdk.emit(OURS, confirmedFrame());
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(2);
    });

    it('a MESSAGE keeps its own confirmed notification: the pending notice does not stand in for the content', async () => {
        const h = await started();
        h.sdk.emit(OURS, pendingFrame({ action: 'MESSAGE' }));
        await flush();
        h.advance(60_000);
        h.sdk.emit(OURS, confirmedFrame({ action: 'MESSAGE' }));
        await flush();
        expect(h.notify.mock.calls.map((c) => c[0].kind)).toEqual(['incoming-pending', 'incoming-message']);
    });

    it('stop() forgets announcements along with everything else', async () => {
        const h = await started();
        h.sdk.emit(OURS, pendingFrame());
        await flush();
        h.svc.stop();
        await h.svc.start();
        h.sdk.emit(OURS, confirmedFrame());
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(2);
    });
});

describe('NotificationService: confirmed-side recipients read destinations[]', () => {
    it('fires incoming-receipt for a NEW_ACTION whose destinations[] names us and which carries no singular destination', async () => {
        const h = await started();
        h.sdk.emit(OURS, confirmedFrame());
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(1);
        expect(h.notify.mock.calls[0][0]).toMatchObject({ kind: 'incoming-receipt', data: { txHash: TX.toLowerCase() } });
    });

    it('still honours the retired singular field from an older explorer', async () => {
        const h = await started();
        h.sdk.emit(OURS, { type: 'NEW_ACTION', data: { action_index: 3, tx_hash: 'aa11', source: STRANGER, destination: OURS } });
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(1);
        expect(h.notify.mock.calls[0][0].kind).toBe('incoming-receipt');
    });

    it('a multi-output send that also pays someone else still reaches us', async () => {
        const h = await started();
        h.sdk.emit(OURS, confirmedFrame({ destinations: ['addrElse', OURS, 'addrThird'] }));
        await flush();
        expect(h.notify).toHaveBeenCalledTimes(1);
    });
});
