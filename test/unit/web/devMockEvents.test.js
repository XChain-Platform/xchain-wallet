// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M1.3: the dev-mock SDK's `onAddress` was a no-op (`() => () => {}`) that
// had never delivered a single WS frame. These tests pin the emitter that
// replaces it: subscribe/emit/unsubscribe, double-unsubscribe safety,
// isolation between subscribers, and `getUnconfirmed` fixture filtering.

import { describe, it, expect } from 'vitest';
import { createDevMockEventBus, seedDefaultFixtures, installDevMockConsole } from '../../../packages/web/src/devMockEvents.js';

describe('createDevMockEventBus', () => {
    it('delivers a MEMPOOL_ACTION frame to an onAddress subscriber on the source address', () => {
        const bus = createDevMockEventBus();
        const frames = [];
        bus.onAddress('addr-a', (frame) => frames.push(frame));

        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: [] });

        expect(frames).toHaveLength(1);
        expect(frames[0].type).toBe('MEMPOOL_ACTION');
        expect(frames[0].data.tx_hash).toBe('tx-1');
        expect(frames[0].data.source).toBe('addr-a');
    });

    it('delivers the same MEMPOOL_ACTION to a destination address subscriber', () => {
        const bus = createDevMockEventBus();
        const frames = [];
        bus.onAddress('addr-b', (frame) => frames.push(frame));

        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: ['addr-b'] });

        expect(frames).toHaveLength(1);
        expect(frames[0].data.destinations).toEqual(['addr-b']);
    });

    it('onMempoolAction receives MEMPOOL_ACTION frames on the same address', () => {
        const bus = createDevMockEventBus();
        const frames = [];
        bus.onMempoolAction('addr-a', (frame) => frames.push(frame));

        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: [] });

        expect(frames).toHaveLength(1);
        expect(frames[0].type).toBe('MEMPOOL_ACTION');
    });

    it('emits MEMPOOL_REMOVED with source/destinations (no action/data) and drops the fixture', () => {
        const bus = createDevMockEventBus();
        const frames = [];
        bus.onAddress('addr-a', (frame) => frames.push(frame));
        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: ['addr-b'] });

        bus.removeMempoolAction('tx-1');

        expect(frames).toHaveLength(2);
        expect(frames[1].type).toBe('MEMPOOL_REMOVED');
        expect(frames[1].data).toEqual({ tx_hash: 'tx-1', source: 'addr-a', destinations: ['addr-b'] });
        expect(bus.getUnconfirmed('addr-a')).toEqual([]);
    });

    it('unsubscribe stops delivery, and calling it twice is safe', () => {
        const bus = createDevMockEventBus();
        const frames = [];
        const unsubscribe = bus.onAddress('addr-a', (frame) => frames.push(frame));

        unsubscribe();
        unsubscribe(); // must not throw, must not disturb anything

        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: [] });
        expect(frames).toHaveLength(0);
    });

    it('unsubscribing one subscriber does not disturb another subscriber on the same address', () => {
        const bus = createDevMockEventBus();
        const framesA = [];
        const framesB = [];
        const unsubscribeA = bus.onAddress('addr-a', (frame) => framesA.push(frame));
        bus.onAddress('addr-a', (frame) => framesB.push(frame));

        unsubscribeA();
        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: [] });

        expect(framesA).toHaveLength(0);
        expect(framesB).toHaveLength(1);
    });

    it('getUnconfirmed matches by source', () => {
        const bus = createDevMockEventBus();
        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: [] });
        bus.pushMempoolAction({ tx_hash: 'tx-2', source: 'addr-z', destinations: [] });

        const rows = bus.getUnconfirmed('addr-a');
        expect(rows).toHaveLength(1);
        expect(rows[0].tx_hash).toBe('tx-1');
    });

    it('getUnconfirmed matches by destinations', () => {
        const bus = createDevMockEventBus();
        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: ['addr-b', 'addr-c'] });

        const rows = bus.getUnconfirmed('addr-c');
        expect(rows).toHaveLength(1);
        expect(rows[0].tx_hash).toBe('tx-1');
    });

    it('getUnconfirmed returns [] (never throws/undefined) when nothing matches', () => {
        const bus = createDevMockEventBus();
        expect(bus.getUnconfirmed('nobody-here')).toEqual([]);

        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: [] });
        expect(bus.getUnconfirmed('addr-unrelated')).toEqual([]);
    });

    it('honors a limit argument', () => {
        const bus = createDevMockEventBus();
        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: [] });
        bus.pushMempoolAction({ tx_hash: 'tx-2', source: 'addr-a', destinations: [] });
        bus.pushMempoolAction({ tx_hash: 'tx-3', source: 'addr-a', destinations: [] });

        expect(bus.getUnconfirmed('addr-a', { limit: 2 })).toHaveLength(2);
        expect(bus.getUnconfirmed('addr-a')).toHaveLength(3); // default limit 100
    });

    it('first_seen defaults to now in UNIX SECONDS, not milliseconds', () => {
        const bus = createDevMockEventBus();
        const before = Math.floor(Date.now() / 1000);
        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: [] });
        const after = Math.floor(Date.now() / 1000);

        const [row] = bus.getUnconfirmed('addr-a');
        // A millisecond timestamp would be ~1000x this range; this bounds it
        // to plausible unix-seconds "now" and would fail hard on an ms bug.
        expect(row.first_seen).toBeGreaterThanOrEqual(before);
        expect(row.first_seen).toBeLessThanOrEqual(after);
    });

    it('an explicit first_seen is honored verbatim', () => {
        const bus = createDevMockEventBus();
        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: [], first_seen: 12345 });
        expect(bus.getUnconfirmed('addr-a')[0].first_seen).toBe(12345);
    });

    it('clearFixtures empties getUnconfirmed without touching subscriptions', () => {
        const bus = createDevMockEventBus();
        const frames = [];
        bus.onAddress('addr-a', (frame) => frames.push(frame));
        bus.pushMempoolAction({ tx_hash: 'tx-1', source: 'addr-a', destinations: [] });

        bus.clearFixtures();
        expect(bus.getUnconfirmed('addr-a')).toEqual([]);

        bus.pushMempoolAction({ tx_hash: 'tx-2', source: 'addr-a', destinations: [] });
        expect(frames).toHaveLength(2); // subscription survived the clear
    });

    it('seedDefaultFixtures populates fixtures visible to both parties', () => {
        const bus = createDevMockEventBus();
        seedDefaultFixtures(bus, { source: 'seed-a', destination: 'seed-b' });

        expect(bus.getUnconfirmed('seed-a').length).toBeGreaterThan(0);
        expect(bus.getUnconfirmed('seed-b').length).toBeGreaterThan(0);
    });
});

describe('installDevMockConsole subscribe surface', () => {
    it('lets a developer watch what a subscriber receives, not just emit', () => {
        const bus = createDevMockEventBus();
        const g = globalThis;
        const had = 'window' in g;
        if (!had) g.window = {};
        installDevMockConsole(bus);
        const m = g.window.__xchainDevMock;

        const seen = [];
        const off = m.onMempoolAction('c-dest', f => seen.push(f));
        m.pushMempoolAction({ tx_hash: 'c-tx', source: 'c-src', destinations: ['c-dest'] });
        expect(seen).toHaveLength(1);
        expect(seen[0].type).toBe('MEMPOOL_ACTION');

        // The returned unsubscribe has to work from the console too.
        off();
        m.pushMempoolAction({ tx_hash: 'c-tx2', source: 'c-src', destinations: ['c-dest'] });
        expect(seen).toHaveLength(1);

        const addrSeen = [];
        const offA = m.onAddress('c-dest', f => addrSeen.push(f));
        m.removeMempoolAction('c-tx');
        expect(addrSeen.map(f => f.type)).toContain('MEMPOOL_REMOVED');
        offA();
        if (!had) delete g.window;
    });
});
