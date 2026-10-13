// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    applyLayoutMode,
    attachLayoutModeListener,
    isSidePanelSupported,
    readLayoutMode,
    writeLayoutMode,
} from '../../../packages/extension/src/background/layoutMode.js';

const STORAGE_KEY = 'xchain.layoutMode';

function stubChrome({ storedMode, withSidePanel = true } = {}) {
    const setPopup = vi.fn().mockResolvedValue(undefined);
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    const storageSet = vi.fn((_items, callback) => callback());
    let listener;
    const chrome = {
        action: { setPopup },
        storage: {
            local: {
                get: vi.fn((_key, callback) => callback({ [STORAGE_KEY]: storedMode })),
                set: storageSet,
            },
            onChanged: {
                addListener: vi.fn((fn) => { listener = fn; }),
                removeListener: vi.fn((fn) => {
                    if (listener === fn) listener = undefined;
                }),
            },
        },
    };
    if (withSidePanel) chrome.sidePanel = { setPanelBehavior };
    vi.stubGlobal('chrome', chrome);
    return { chrome, setPopup, setPanelBehavior, storageSet, listener: () => listener };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('layout mode', () => {
    it('defaults missing and invalid stored values to popup mode', async () => {
        expect(await readLayoutMode()).toBe('popup');

        stubChrome({ storedMode: 'floating' });
        expect(await readLayoutMode()).toBe('popup');
    });

    it('reads and writes supported modes through chrome.storage.local', async () => {
        const { storageSet } = stubChrome({ storedMode: 'sidepanel' });

        expect(await readLayoutMode()).toBe('sidepanel');
        await writeLayoutMode('popup');

        expect(storageSet).toHaveBeenCalledWith(
            { [STORAGE_KEY]: 'popup' },
            expect.any(Function),
        );
        await expect(writeLayoutMode('floating')).rejects.toThrow(/invalid mode floating/);
    });

    it('configures the action for side-panel and popup modes', async () => {
        const { setPopup, setPanelBehavior } = stubChrome();

        expect(isSidePanelSupported()).toBe(true);
        await applyLayoutMode('sidepanel');
        await applyLayoutMode('popup');

        expect(setPopup.mock.calls).toEqual([
            [{ popup: '' }],
            [{ popup: 'popup.html' }],
        ]);
        expect(setPanelBehavior.mock.calls).toEqual([
            [{ openPanelOnActionClick: true }],
            [{ openPanelOnActionClick: false }],
        ]);
    });

    it('falls back to popup behavior when the side-panel API is absent', async () => {
        const { setPopup, setPanelBehavior } = stubChrome({ withSidePanel: false });

        expect(isSidePanelSupported()).toBe(false);
        await applyLayoutMode('sidepanel');

        expect(setPopup).toHaveBeenCalledWith({ popup: 'popup.html' });
        expect(setPanelBehavior).not.toHaveBeenCalled();
    });

    it('applies valid local changes and detaches its listener', async () => {
        const { chrome, setPopup, listener } = stubChrome();
        const detach = attachLayoutModeListener();

        listener()({ [STORAGE_KEY]: { newValue: 'sidepanel' } }, 'sync');
        listener()({ [STORAGE_KEY]: { newValue: 'floating' } }, 'local');
        listener()({ [STORAGE_KEY]: { newValue: 'sidepanel' } }, 'local');
        await vi.waitFor(() => expect(setPopup).toHaveBeenCalledWith({ popup: '' }));

        detach();
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1);
        expect(listener()).toBeUndefined();
    });
});
