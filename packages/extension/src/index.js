// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @xchain-wallet/extension
//
// Chrome MV3 extension shell: popup, full-screen tab, background service
// worker, content script, and injected window.xchain provider.
// See SPEC.md §9.3.1 (process isolation), §24 (shell & navigation), §43 (dApp bridge).
//
// Implementation begins in Phase 1.

export {
    ChromeStorageBackend,
    DEFAULT_STORAGE_KEY,
} from './storage/ChromeStorageBackend.js';
export {
    ChromeSessionBackend,
    DEFAULT_SESSION_STORAGE_KEY,
} from './storage/ChromeSessionBackend.js';
export * as background from './background/index.js';
export * as bridge from './bridge/index.js';
