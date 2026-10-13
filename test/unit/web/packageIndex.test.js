// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

const exportsFixture = vi.hoisted(() => ({
    IndexedDBStorageBackend: class IndexedDBStorageBackend {},
    WebMetaBackend: class WebMetaBackend {},
    sendMessage: vi.fn(),
}));

vi.mock('../../../packages/web/src/storage/IndexedDBStorageBackend.js', () => ({
    IndexedDBStorageBackend: exportsFixture.IndexedDBStorageBackend,
    DEFAULT_DB_NAME: 'db-name',
    DEFAULT_STORE_NAME: 'store-name',
    DEFAULT_STORAGE_KEY: 'storage-key',
}));

vi.mock('../../../packages/web/src/storage/WebMetaBackend.js', () => ({
    WebMetaBackend: exportsFixture.WebMetaBackend,
    DEFAULT_META_KEY: 'meta-key',
}));

vi.mock('../../../packages/web/src/hostBridge.js', () => ({
    sendMessage: exportsFixture.sendMessage,
}));

import * as web from '../../../packages/web/src/index.js';

describe('@xchain-wallet/web package exports', () => {
    it('exposes storage defaults and the host bridge namespace', () => {
        expect(web).toMatchObject({
            IndexedDBStorageBackend: exportsFixture.IndexedDBStorageBackend,
            WebMetaBackend: exportsFixture.WebMetaBackend,
            DEFAULT_DB_NAME: 'db-name',
            DEFAULT_STORE_NAME: 'store-name',
            DEFAULT_STORAGE_KEY: 'storage-key',
            DEFAULT_META_KEY: 'meta-key',
        });
        expect(web.hostBridge.sendMessage).toBe(exportsFixture.sendMessage);
    });
});
