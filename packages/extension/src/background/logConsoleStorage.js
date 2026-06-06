// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// logConsoleStorage — §48.5 / Cluster Q FOLLOWUP 5.
//
// Persistence layer for the logConsole ring buffer so a service-worker /
// renderer crash doesn't wipe the diagnostic context the dApp Bridge,
// signer, vault, and encoder emissions accrued in the seconds before the
// crash. Without this, a user filing a bug report after a hang gets a
// dump that's been cleared to bare-metal — exactly when the recent
// emissions matter most.
//
// Mirrors the broadcastQueueStorage / signThrottleStorage pattern:
//   - Extension SW    → `chrome.storage.local`
//   - Web renderer    → `localStorage`
//   - Desktop renderer → `localStorage` (same Chromium runtime)
//   - Tests / no shell → null (in-memory only, the v0.321.0 behavior)
//
// Snapshot shape: `{ entries: LogEntry[] }`, where each entry matches
// `packages/core/src/shared/utils/logConsole.js`'s LogEntry typedef. The
// load path filters anything that doesn't match the canonical shape so a
// corrupt persisted blob can't crash the background process at boot.
//
// Source whitelist: enforced upstream by `logConsole.attachMirror`'s
// default `sourceAllow` predicate. This adapter is dumb storage —
// whatever the mirror passes in, we persist.

const STORAGE_KEY = 'xchain.logConsole';

/**
 * @typedef {Object} PersistedLogEntry
 * @property {number} id
 * @property {number} timestamp
 * @property {'log'|'info'|'warn'|'error'} level
 * @property {string} source
 * @property {string} message
 */

/**
 * @typedef {Object} LogConsoleStorage
 * @property {() => Promise<PersistedLogEntry[]>} load
 * @property {(entries: PersistedLogEntry[]) => Promise<void>} save
 * @property {() => Promise<void>} clear
 */

/**
 * @returns {LogConsoleStorage | null}
 */
export function createLogConsoleStorage() {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        return chromeLocalAdapter();
    }
    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
            return localStorageAdapter();
        }
    } catch (_e) {
        /* ignore */
    }
    return null;
}

function chromeLocalAdapter() {
    return {
        async load() {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.get(STORAGE_KEY, (items) => {
                        resolve(coerceEntries(items?.[STORAGE_KEY]));
                    });
                } catch (_e) {
                    resolve([]);
                }
            });
        },
        async save(entries) {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.set(
                        { [STORAGE_KEY]: { entries: coerceEntries(entries) } },
                        () => resolve(),
                    );
                } catch (_e) {
                    resolve();
                }
            });
        },
        async clear() {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.remove(STORAGE_KEY, () => resolve());
                } catch (_e) {
                    resolve();
                }
            });
        },
    };
}

function localStorageAdapter() {
    return {
        async load() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (typeof raw !== 'string' || !raw) return [];
                return coerceEntries(JSON.parse(raw));
            } catch (_e) {
                return [];
            }
        },
        async save(entries) {
            try {
                localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify({ entries: coerceEntries(entries) }),
                );
            } catch (_e) {
                // Quota / privacy mode — tolerate so the live buffer stays
                // serviceable.
            }
        },
        async clear() {
            try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }
        },
    };
}

const ALLOWED_LEVELS = new Set(['log', 'info', 'warn', 'error']);

/**
 * Defensive coerce — only entries with the canonical shape survive.
 * Accepts either a raw array or an envelope `{ entries: LogEntry[] }`.
 *
 * @param {unknown} v
 * @returns {PersistedLogEntry[]}
 */
function coerceEntries(v) {
    let arr = null;
    if (Array.isArray(v)) arr = v;
    else if (v && typeof v === 'object' && Array.isArray(v.entries)) arr = v.entries;
    if (!arr) return [];
    /** @type {PersistedLogEntry[]} */
    const out = [];
    for (const raw of arr) {
        if (!raw || typeof raw !== 'object') continue;
        const id = Number.isFinite(raw.id) ? raw.id : null;
        const timestamp = Number.isFinite(raw.timestamp) ? raw.timestamp : null;
        const level = ALLOWED_LEVELS.has(raw.level) ? raw.level : null;
        const source = typeof raw.source === 'string' && raw.source.length > 0 ? raw.source : null;
        const message = typeof raw.message === 'string' ? raw.message : null;
        if (id === null || timestamp === null || !level || !source || message === null) continue;
        out.push({ id, timestamp, level, source, message });
    }
    return out;
}
