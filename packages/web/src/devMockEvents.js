// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M1.3: the dev-mock SDK's WS surface was inert (`onAddress() { return
// () => {}; }`, hostBridge.js) and had never delivered a single frame
// (I-36). This module is the emitter that fixes that, kept separate from
// hostBridge.js so it is independently unit-testable without dragging in
// the whole mock SDK proxy.
//
// Frame contract is spec-fixed (I-5/I-10/I-43), not invented here:
//   MEMPOOL_ACTION data: { tx_hash, source, action, data, first_seen, destinations }
//   MEMPOOL_REMOVED data: { tx_hash, source, destinations }
//   getUnconfirmed rows: same shape as MEMPOOL_ACTION's data field.
// `first_seen` is UNIX SECONDS; the wallet's history date filter drops
// null-timestamp entries, so getting the units wrong here would make a
// scripted fixture silently vanish under the default 30-day filter.

/**
 * @typedef {Object} MempoolFixtureRow
 * @property {string} tx_hash
 * @property {string} source
 * @property {string} action        bare action-name token, e.g. "SEND"
 * @property {string} data          pipe-joined canonical action string
 * @property {number|null} first_seen  unix SECONDS
 * @property {string[]} destinations
 */

/** Every address a fixture row is visible to: its source plus each destination. */
function partiesFor(row) {
    const parties = new Set();
    if (row.source) parties.add(row.source);
    for (const dest of row.destinations || []) parties.add(dest);
    return parties;
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

/**
 * Creates one independent dev-mock event bus: per-address subscriber
 * registries for `onAddress`/`onMempoolAction`, a fixtures store behind
 * `getUnconfirmed`, and the push/remove/clear methods dev tooling scripts
 * against. Framework-agnostic (no window/DOM access) so it is plain to
 * unit test; `installDevMockConsole` below is the only piece that touches
 * `window`.
 */
export function createDevMockEventBus() {
    /** @type {Map<string, Set<Function>>} address -> subscribers wanting every frame */
    const addressSubs = new Map();
    /** @type {Map<string, Set<Function>>} address -> subscribers wanting MEMPOOL_ACTION only */
    const mempoolActionSubs = new Map();
    /** @type {Map<string, MempoolFixtureRow>} tx_hash -> row */
    const fixtures = new Map();

    function subscribe(registry, address, callback) {
        if (typeof callback !== 'function') return () => {};
        let subs = registry.get(address);
        if (!subs) {
            subs = new Set();
            registry.set(address, subs);
        }
        subs.add(callback);
        // Double-unsubscribe safety: the returned closure only ever removes
        // ITS OWN callback once, so calling it twice (or after the address's
        // subscriber set was already cleaned up) is a no-op rather than
        // touching a sibling subscriber's entry.
        let unsubscribed = false;
        return () => {
            if (unsubscribed) return;
            unsubscribed = true;
            subs.delete(callback);
            if (subs.size === 0) registry.delete(address);
        };
    }

    function deliver(registry, address, frame) {
        const subs = registry.get(address);
        if (!subs) return;
        // Snapshot before iterating: a callback that unsubscribes itself (or
        // another address's subscriber) mid-emit must not corrupt the Set
        // being iterated.
        for (const callback of Array.from(subs)) {
            callback(frame);
        }
    }

    function onAddress(address, callback) {
        return subscribe(addressSubs, address, callback);
    }

    function onMempoolAction(address, callback) {
        return subscribe(mempoolActionSubs, address, callback);
    }

    /**
     * @param {string} address
     * @param {{ limit?: number }} [opts]
     * @returns {MempoolFixtureRow[]} rows where the address is the source or
     *   named in destinations; [] when nothing matches (never throws/undefined).
     */
    function getUnconfirmed(address, opts) {
        const limit = Number.isFinite(opts?.limit) ? opts.limit : 100;
        const rows = [];
        for (const row of fixtures.values()) {
            if (row.source === address || (row.destinations || []).includes(address)) {
                rows.push(row);
            }
        }
        return rows.slice(0, limit);
    }

    /**
     * Adds (or replaces, by tx_hash) a fixture and emits MEMPOOL_ACTION to
     * every party's address channel plus their mempool-action subscribers.
     * @param {Partial<MempoolFixtureRow> & { tx_hash: string, source: string }} input
     */
    function pushMempoolAction(input) {
        const row = {
            tx_hash: input.tx_hash,
            source: input.source,
            action: input.action ?? 'SEND',
            data: input.data ?? `${input.action ?? 'SEND'}|0`,
            // Default to "now" in SECONDS, never 0 and never ms - a bad unit
            // here reads as a valid past timestamp and the entry just
            // disappears under the default history date filter.
            first_seen: Number.isFinite(input.first_seen) ? input.first_seen : nowSeconds(),
            destinations: Array.isArray(input.destinations) ? input.destinations : [],
        };
        fixtures.set(row.tx_hash, row);
        const frame = {
            type: 'MEMPOOL_ACTION',
            chain: input.chain,
            network: input.network,
            timestamp: Date.now(),
            data: {
                tx_hash: row.tx_hash,
                source: row.source,
                action: row.action,
                data: row.data,
                first_seen: row.first_seen,
                destinations: row.destinations,
            },
        };
        for (const address of partiesFor(row)) {
            deliver(addressSubs, address, frame);
            deliver(mempoolActionSubs, address, frame);
        }
        return row;
    }

    /**
     * Emits MEMPOOL_REMOVED for a fixture (simulating confirmation or
     * eviction) and drops it from the store. No-op on an unknown tx_hash.
     * @param {string} txHash
     * @param {{ chain?: string, network?: string }} [opts]
     */
    function removeMempoolAction(txHash, opts) {
        const row = fixtures.get(txHash);
        if (!row) return;
        fixtures.delete(txHash);
        const frame = {
            type: 'MEMPOOL_REMOVED',
            chain: opts?.chain,
            network: opts?.network,
            timestamp: Date.now(),
            data: {
                tx_hash: row.tx_hash,
                source: row.source,
                destinations: row.destinations,
            },
        };
        for (const address of partiesFor(row)) {
            deliver(addressSubs, address, frame);
        }
    }

    /** Drops every fixture with no emit; subscribers are left registered. */
    function clearFixtures() {
        fixtures.clear();
    }

    return {
        onAddress,
        onMempoolAction,
        getUnconfirmed,
        pushMempoolAction,
        removeMempoolAction,
        clearFixtures,
    };
}

/**
 * Seeds a couple of default fixtures so the dev shell shows pending activity
 * on load with no scripting required. Trivially clearable via
 * `window.__xchainDevMock.clear()`.
 */
export function seedDefaultFixtures(bus, { source = 'devmock-source-address', destination = 'devmock-dest-address' } = {}) {
    bus.pushMempoolAction({
        tx_hash: 'devmock-seed-tx-1',
        source,
        action: 'SEND',
        data: `SEND|0|XCHAIN|100|${destination}`,
        destinations: [destination],
    });
    bus.pushMempoolAction({
        tx_hash: 'devmock-seed-tx-2',
        source: destination,
        action: 'SEND',
        data: `SEND|0|XCHAIN|25|${source}|welcome`,
        destinations: [source],
    });
}

// Console one-liners a developer types against the default mock dev shell
// (`pnpm -C packages/web dev`, no VITE_XCHAIN_REAL_SDK):
//
//   // make a new pending tx appear (SEND from devmock-source-address to
//   // devmock-dest-address), delivered on both addresses' channels:
//   window.__xchainDevMock.pushMempoolAction({ tx_hash: 'tx-demo-1', source: 'devmock-source-address', action: 'SEND', data: 'SEND|0|XCHAIN|50|devmock-dest-address', destinations: ['devmock-dest-address'] })
//
//   // "confirm" it (emits MEMPOOL_REMOVED and drops the fixture):
//   window.__xchainDevMock.removeMempoolAction('tx-demo-1')
//
//   // wipe every fixture (subscriptions stay live):
//   window.__xchainDevMock.clear()
//
//   // inspect what getUnconfirmed would currently return for an address:
//   window.__xchainDevMock.getUnconfirmed('devmock-dest-address')
/**
 * Attaches the scripting surface to `window.__xchainDevMock`. Callers gate
 * this behind the same `!import.meta.env?.PROD` check that dead-code-
 * eliminates the rest of the dev mock, so it never reaches a production
 * bundle. A no-op when `window` doesn't exist (Node smoke tests).
 */
export function installDevMockConsole(bus) {
    if (typeof window === 'undefined') return;
    window.__xchainDevMock = {
        pushMempoolAction: (row) => bus.pushMempoolAction(row),
        removeMempoolAction: (txHash, opts) => bus.removeMempoolAction(txHash, opts),
        getUnconfirmed: (address, opts) => bus.getUnconfirmed(address, opts),
        clear: () => bus.clearFixtures(),
        // Subscribing from the console matters as much as emitting: without it a
        // developer can push a fixture but cannot watch what a subscriber would
        // actually receive, which is the half that catches a wrong frame shape.
        // Both return their unsubscribe function, same as the SDK surface.
        onMempoolAction: (address, cb) => bus.onMempoolAction(address, cb),
        onAddress: (address, cb) => bus.onAddress(address, cb),
    };
}
