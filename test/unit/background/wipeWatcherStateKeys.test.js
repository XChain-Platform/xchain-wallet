// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The service worker's notification watchers keep their seen, fired and
// notified sets in chrome.storage.local under the names exported here. A wipe
// that names any other spelling leaves the erased wallet's sets behind for the
// next wallet in the same profile.

import { describe, it, expect } from 'vitest';

import {
    WALLET_LOCAL_KEYS,
    WATCHER_STATE_LOCAL_KEYS,
    wipeExtensionStorage,
} from '@xchain-wallet/extension/src/background/wipeExtensionStorage.js';

function mapArea(seed) {
    const map = new Map(Object.entries(seed));
    return {
        map,
        async get(keys) {
            if (keys == null) return Object.fromEntries(map);
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.filter((k) => map.has(k)).map((k) => [k, map.get(k)]));
        },
        async remove(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) map.delete(k); },
        async clear() { map.clear(); },
    };
}

describe('background/wipeExtensionStorage watcher state', () => {
    it('names the keys the worker watchers write, and the wipe list carries them', () => {
        expect([...WATCHER_STATE_LOCAL_KEYS].sort()).toEqual([
            'coinpayAutopayNotified',
            'deadlinesSeen',
            'dispenserEscrowSeen',
            'governancePollsSeen',
            'priceAlertsFired',
        ]);
        expect(WALLET_LOCAL_KEYS).toEqual(expect.arrayContaining([...WATCHER_STATE_LOCAL_KEYS]));
    });

    it('erases each seen, fired and notified set the worker watchers persist', async () => {
        const seed = Object.fromEntries(WATCHER_STATE_LOCAL_KEYS.map((k) => [k, ['id-1']]));
        const local = mapArea({ ...seed, 'xchain.layoutMode': 'popup' });
        const res = await wipeExtensionStorage({ local, session: mapArea({}) });
        expect(res.ok).toBe(true);
        for (const key of WATCHER_STATE_LOCAL_KEYS) expect(local.map.has(key), key).toBe(false);
        expect([...local.map.keys()]).toEqual(['xchain.layoutMode']);
    });
});
