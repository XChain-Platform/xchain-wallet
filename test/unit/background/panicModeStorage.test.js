// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { initPanicModePersistence } from '../../../packages/extension/src/background/panicModeStorage.js';

const STORAGE_KEY = 'xchain.panicMode';

function makeFlows() {
    return {
        configurePanicModePersistence: vi.fn().mockResolvedValue(undefined),
        applyExternalPanicModeState: vi.fn(),
    };
}

function stubChromeStorage() {
    const items = {};
    let listener;
    let throwOnGet = false;
    vi.stubGlobal('chrome', {
        storage: {
            local: {
                get: (key, callback) => {
                    if (throwOnGet) throw new Error('read failed');
                    callback({ [key]: items[key] });
                },
                set: (values, callback) => {
                    Object.assign(items, values);
                    callback();
                },
                remove: (key, callback) => {
                    delete items[key];
                    callback();
                },
            },
            onChanged: {
                addListener: (nextListener) => { listener = nextListener; },
            },
        },
    });
    return {
        items,
        getListener: () => listener,
        failReads: () => { throwOnGet = true; },
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('initPanicModePersistence', () => {
    it.each([
        ['no chrome global', undefined],
        ['no local storage', { storage: {} }],
    ])('does nothing with %s', async (_label, chromeValue) => {
        vi.stubGlobal('chrome', chromeValue);
        const flows = makeFlows();

        await initPanicModePersistence(flows);

        expect(flows.configurePanicModePersistence).not.toHaveBeenCalled();
        expect(flows.applyExternalPanicModeState).not.toHaveBeenCalled();
    });

    it('configures a store that loads, saves, clears, and tolerates read failures', async () => {
        const chromeStorage = stubChromeStorage();
        const flows = makeFlows();

        await initPanicModePersistence(flows);

        expect(flows.configurePanicModePersistence).toHaveBeenCalledTimes(1);
        const store = flows.configurePanicModePersistence.mock.calls[0][0];
        expect(await store.load()).toBeNull();

        const state = { enabled: true, activatedAt: 42 };
        await store.save(state);
        expect(chromeStorage.items).toEqual({ [STORAGE_KEY]: state });
        expect(await store.load()).toEqual(state);

        await store.clear();
        expect(chromeStorage.items).not.toHaveProperty(STORAGE_KEY);
        expect(await store.load()).toBeNull();

        chromeStorage.failReads();
        await expect(store.load()).resolves.toBeNull();
    });

    it('forwards only local panic-mode storage changes', async () => {
        const chromeStorage = stubChromeStorage();
        const flows = makeFlows();
        await initPanicModePersistence(flows);
        const listener = chromeStorage.getListener();

        const state = { enabled: true };
        listener({ [STORAGE_KEY]: { newValue: state } }, 'local');
        listener({ [STORAGE_KEY]: { oldValue: state } }, 'local');
        listener({ [STORAGE_KEY]: { newValue: 'ignored' } }, 'sync');
        listener({ other: { newValue: 'ignored' } }, 'local');

        expect(flows.applyExternalPanicModeState.mock.calls).toEqual([
            [state],
            [null],
        ]);
    });
});
