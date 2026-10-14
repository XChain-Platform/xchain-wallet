// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    ChromeSessionBackend,
    ChromeStorageBackend,
    DEFAULT_SESSION_STORAGE_KEY,
    DEFAULT_STORAGE_KEY,
    background,
    bridge,
} from '../../../packages/extension/src/index.js';
import { ChromeSessionBackend as DirectSessionBackend } from '../../../packages/extension/src/storage/ChromeSessionBackend.js';
import { ChromeStorageBackend as DirectStorageBackend } from '../../../packages/extension/src/storage/ChromeStorageBackend.js';

describe('@xchain-wallet/extension public index', () => {
    it('exposes both persistent and session storage backends', () => {
        expect(ChromeStorageBackend).toBe(DirectStorageBackend);
        expect(ChromeSessionBackend).toBe(DirectSessionBackend);
        expect(DEFAULT_STORAGE_KEY).toBe('xchain-wallet:vault');
        expect(DEFAULT_SESSION_STORAGE_KEY).toBe('xchain-wallet:session');
    });

    it('exposes background and bridge namespaces', () => {
        expect(background).toEqual(expect.objectContaining({
            createBackgroundHost: expect.any(Function),
            attachChromeRuntime: expect.any(Function),
        }));
        expect(bridge).toEqual(expect.objectContaining({
            registerBridgeHandlers: expect.any(Function),
            rejectAllApprovals: expect.any(Object),
            createBridgeEventBroadcaster: expect.any(Function),
        }));
    });
});
