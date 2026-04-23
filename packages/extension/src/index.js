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
