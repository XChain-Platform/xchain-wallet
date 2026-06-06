// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// @xchain-wallet/web
//
// Browser SPA shell. Consumes @xchain-wallet/core and
// @xchain-wallet/extension (for the shared background host factory —
// see hostBridge.js).
// See SPEC.md §9.2, §8.1 (target matrix), §9.3.3 (web key isolation).

export {
    IndexedDBStorageBackend,
    DEFAULT_DB_NAME,
    DEFAULT_STORE_NAME,
    DEFAULT_STORAGE_KEY,
} from './storage/IndexedDBStorageBackend.js';
export {
    WebMetaBackend,
    DEFAULT_META_KEY,
} from './storage/WebMetaBackend.js';
export * as hostBridge from './hostBridge.js';
