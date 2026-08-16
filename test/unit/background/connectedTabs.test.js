// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Connected-tab registry (§43.2 delivery set).
//
// This is the piece that replaced `chrome.tabs.query({})` +
// `new URL(tab.url).origin` in the bridge event broadcaster. That filter never
// delivered anything, because MV3 populates `Tab.url` only for an extension
// holding the "tabs" permission or a matching host permission and this
// manifest holds neither, so the whole accountsChanged / chainChanged /
// disconnect pipeline was dead in the shipped build. The registry answers the
// same question from unforgeable `sender` data.
//
// What is worth pinning here is not the Map, it is the two hazards that come
// with persisting one across an MV3 service-worker eviction:
//
//   - a live write during a cold read must not be overwritten by the stale
//     copy that read returns, and a live forget must not be resurrected by it;
//   - a partial in-memory map must never be persisted OVER a fuller stored
//     one, which is what a naive write-before-hydrate does.

import { describe, it, expect } from 'vitest';
import {
    createConnectedTabRegistry,
    CONNECTED_TABS_SESSION_KEY,
} from '../../../packages/extension/src/background/connectedTabs.js';

// A chrome.storage.session double. `gate` lets a test hold the read open, which
// is the only way to exercise the hydration races above.
function fakeSessionArea(initial = {}, { gate = null } = {}) {
    const store = { ...(Object.keys(initial).length ? { [CONNECTED_TABS_SESSION_KEY]: initial } : {}) };
    const writes = [];
    return {
        _store: store,
        _writes: writes,
        get(key, cb) {
            const deliver = () => cb({ [key]: store[key] });
            if (gate) gate.then(deliver);
            else deliver();
        },
        set(items, cb) {
            Object.assign(store, JSON.parse(JSON.stringify(items)));
            writes.push(JSON.parse(JSON.stringify(items[CONNECTED_TABS_SESSION_KEY])));
            cb();
        },
    };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('connected-tab registry', () => {
    it('returns only the tabs recorded for the asked-for origin', async () => {
        const registry = createConnectedTabRegistry({ sessionArea: fakeSessionArea() });
        registry.record(1, 'https://dapp.example');
        registry.record(2, 'https://other.example');
        registry.record(3, 'https://dapp.example');

        expect((await registry.tabsForOrigin('https://dapp.example')).sort())
            .toEqual([1, 3]);
        expect(await registry.tabsForOrigin('https://other.example')).toEqual([2]);
        expect(await registry.tabsForOrigin('https://never.example')).toEqual([]);
    });

    it('re-keys a tab that moved to a new origin instead of listing it twice', async () => {
        const registry = createConnectedTabRegistry({ sessionArea: fakeSessionArea() });
        registry.record(1, 'https://dapp.example');
        registry.record(1, 'https://other.example');

        expect(await registry.tabsForOrigin('https://dapp.example')).toEqual([]);
        expect(await registry.tabsForOrigin('https://other.example')).toEqual([1]);
    });

    it('ignores a non-integer tab id and an empty origin', async () => {
        const registry = createConnectedTabRegistry({ sessionArea: fakeSessionArea() });
        registry.record('1', 'https://dapp.example');
        registry.record(1.5, 'https://dapp.example');
        registry.record(2, '');
        registry.record(3, undefined);

        expect(await registry.snapshot()).toEqual({});
    });

    it('rehydrates a map a service-worker eviction dropped', async () => {
        const area = fakeSessionArea({ 4: 'https://dapp.example' });
        // A cold worker: nothing in memory, everything in storage.session.
        const registry = createConnectedTabRegistry({ sessionArea: area });
        expect(await registry.tabsForOrigin('https://dapp.example')).toEqual([4]);
    });

    it('lets a live record win over the stale copy a cold read returns', async () => {
        let openGate;
        const gate = new Promise((resolve) => { openGate = resolve; });
        const area = fakeSessionArea({ 4: 'https://stale.example' }, { gate });
        const registry = createConnectedTabRegistry({ sessionArea: area });

        // The dApp re-handshakes from tab 4 on a new origin while the read of
        // the stored map is still in flight. Losing this race silently sends
        // the tab's events to the origin it used to be on.
        registry.record(4, 'https://fresh.example');
        openGate();

        expect(await registry.tabsForOrigin('https://fresh.example')).toEqual([4]);
        expect(await registry.tabsForOrigin('https://stale.example')).toEqual([]);
    });

    it('does not resurrect a tab closed while the cold read was in flight', async () => {
        let openGate;
        const gate = new Promise((resolve) => { openGate = resolve; });
        const area = fakeSessionArea({ 4: 'https://dapp.example' }, { gate });
        const registry = createConnectedTabRegistry({ sessionArea: area });

        registry.forget(4);
        openGate();

        expect(await registry.tabsForOrigin('https://dapp.example')).toEqual([]);
        await settle();
        expect(area._store[CONNECTED_TABS_SESSION_KEY]).toEqual({});
    });

    it('never persists a partial map over a fuller stored one', async () => {
        let openGate;
        const gate = new Promise((resolve) => { openGate = resolve; });
        const area = fakeSessionArea({ 4: 'https://dapp.example' }, { gate });
        const registry = createConnectedTabRegistry({ sessionArea: area });

        // A cold worker's first bridge call. The write must wait for hydration,
        // or tab 4 is dropped from storage by a map that never saw it.
        registry.record(9, 'https://other.example');
        openGate();
        await settle();

        expect(area._store[CONNECTED_TABS_SESSION_KEY]).toEqual({
            4: 'https://dapp.example',
            9: 'https://other.example',
        });
    });

    it('evicts a tab on chrome.tabs.onRemoved', async () => {
        const area = fakeSessionArea();
        const registry = createConnectedTabRegistry({ sessionArea: area });
        let listener = null;
        const detach = registry.attach({
            onRemoved: {
                addListener: (fn) => { listener = fn; },
                removeListener: () => { listener = null; },
            },
        });

        registry.record(1, 'https://dapp.example');
        registry.record(2, 'https://dapp.example');
        listener(1, { windowId: 0, isWindowClosing: false });

        expect(await registry.tabsForOrigin('https://dapp.example')).toEqual([2]);
        await settle();
        expect(area._store[CONNECTED_TABS_SESSION_KEY]).toEqual({ 2: 'https://dapp.example' });

        detach();
        expect(listener).toBe(null);
    });

    it('drops the oldest entry once the cap is reached', async () => {
        const registry = createConnectedTabRegistry({
            sessionArea: fakeSessionArea(),
            maxEntries: 2,
        });
        registry.record(1, 'https://a.example');
        registry.record(2, 'https://b.example');
        registry.record(3, 'https://c.example');

        expect(Object.keys(await registry.snapshot()).sort()).toEqual(['2', '3']);
    });

    it('works with no storage at all, in memory only', async () => {
        const registry = createConnectedTabRegistry({ sessionArea: null });
        registry.record(1, 'https://dapp.example');
        expect(await registry.tabsForOrigin('https://dapp.example')).toEqual([1]);
    });

    it('degrades to an empty delivery set when the read throws', async () => {
        const registry = createConnectedTabRegistry({
            sessionArea: {
                get() { throw new Error('storage unavailable'); },
                set(_items, cb) { cb(); },
            },
        });
        // A storage failure must cost delivery, never propagate into the bridge
        // handler that triggered the event.
        await expect(registry.tabsForOrigin('https://dapp.example')).resolves.toEqual([]);
        registry.record(1, 'https://dapp.example');
        expect(await registry.tabsForOrigin('https://dapp.example')).toEqual([1]);
    });
});
