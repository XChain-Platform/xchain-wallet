// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The persistent-storage request the web shell makes once per page load.
//
// Two users reported on 2026-09-16 that the web wallet asked for their
// recovery phrase again after a day or so. The vault sits in IndexedDB,
// which is best-effort storage until `navigator.storage.persist()` is
// granted; before this module the wallet never asked. What matters here:
// the request is made, made ONCE, never throws into the caller, and its
// answer is reported so the diagnostic dump can say which bucket the vault
// is in.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    requestPersistentStorage,
    __resetPersistenceForTests,
} from '../../../packages/web/src/storage/storagePersistence.js';

const originalNavigator = globalThis.navigator;

function installNavigator(storage) {
    Object.defineProperty(globalThis, 'navigator', {
        value: storage === undefined ? {} : { storage },
        configurable: true,
        writable: true,
    });
}

beforeEach(() => __resetPersistenceForTests());
afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true,
    });
});

describe('requestPersistentStorage', () => {
    it('asks for the persistent bucket and reports the grant', async () => {
        const persist = vi.fn().mockResolvedValue(true);
        installNavigator({ persisted: vi.fn().mockResolvedValue(false), persist });
        await expect(requestPersistentStorage()).resolves.toBe(true);
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('reports a refusal as false, never as a throw', async () => {
        installNavigator({ persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(false) });
        await expect(requestPersistentStorage()).resolves.toBe(false);
    });

    it('does not re-ask an origin that is already persistent', async () => {
        // Firefox answers persist() with a prompt; a user who was granted
        // it once must not be prompted again on every load.
        const persist = vi.fn().mockResolvedValue(true);
        installNavigator({ persisted: vi.fn().mockResolvedValue(true), persist });
        await expect(requestPersistentStorage()).resolves.toBe(true);
        expect(persist).not.toHaveBeenCalled();
    });

    it('asks once per page load, however many status refreshes happen', async () => {
        const persist = vi.fn().mockResolvedValue(true);
        installNavigator({ persisted: vi.fn().mockResolvedValue(false), persist });
        await Promise.all([requestPersistentStorage(), requestPersistentStorage(), requestPersistentStorage()]);
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('answers null where the API is missing, so the caller keeps booting', async () => {
        installNavigator(undefined);
        await expect(requestPersistentStorage()).resolves.toBeNull();
    });

    it('swallows an API that throws: the vault must still open', async () => {
        installNavigator({ persisted: vi.fn().mockRejectedValue(new Error('blocked by policy')), persist: vi.fn() });
        await expect(requestPersistentStorage()).resolves.toBeNull();
    });
});
