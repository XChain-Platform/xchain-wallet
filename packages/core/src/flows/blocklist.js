// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Origin blocklist (§12 / G009). User-managed list of origins that
// should be hard-rejected at the bridge boundary: `bridge.connect`
// short-circuits, and the four sign methods reject before going to
// approvals.
//
// "Allowlist" semantics live elsewhere: a `ConnectedSite` record
// already gates whether a site has been approved at all (the absence
// of a record means an origin must call `connect()` and get user
// approval). The blocklist is the explicit complement: an origin
// listed here can never connect or sign even if it previously had
// approval, until the user removes it.
//
// Storage shape: `settings.blockedOrigins: string[]`, v2-tolerant.
// Entries can be:
//   - exact origin   "https://example.com" (default; safest)
//   - wildcard host  "*.example.com"  (Cluster S FOLLOWUP 3)
//                    matches any subdomain. The pattern is stored as
//                    `*.example.com` (no scheme) and matched against
//                    the request's URL.host. The bare apex is NOT
//                    matched by `*.example.com`; add `example.com`
//                    or `*.example.com` separately as the user wishes.
// Bare hosts ("example.com") are normalized to `https://example.com`
// at write time so case + protocol comparisons stay simple. Wildcard
// patterns are kept verbatim (no scheme) so the stored entry tells
// the user it's a pattern, not an origin.

const WILDCARD_RE = /^\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;

/**
 * Detect a wildcard pattern like `*.example.com`. Returns the bare
 * domain (no leading `*.`) on match, null otherwise.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function parseWildcardPattern(input) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    const match = WILDCARD_RE.exec(trimmed);
    if (!match) return null;
    return match[1].toLowerCase();
}

/**
 * Normalize a blocklist entry. Wildcard patterns return as-is
 * (lowercased); exact hosts return as `URL.origin`. Returns null for
 * malformed input so the caller can reject the write.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeBlocklistEntry(input) {
    const wildcardDomain = parseWildcardPattern(input);
    if (wildcardDomain) {
        return `*.${wildcardDomain}`;
    }
    return normalizeOrigin(input);
}

export function normalizeOrigin(input) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed).origin;
    } catch {
        // Bare host (no scheme). Try with https://.
        if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
            try {
                return new URL(`https://${trimmed}`).origin;
            } catch {
                return null;
            }
        }
        return null;
    }
}

/**
 * @param {string} origin   the request origin (URL.origin shape)
 * @param {string} pattern  a `*.example.com` wildcard pattern
 */
function matchesWildcard(origin, pattern) {
    const wildcardDomain = parseWildcardPattern(pattern);
    if (!wildcardDomain) return false;
    let host;
    try {
        host = new URL(origin).host.toLowerCase();
    } catch {
        return false;
    }
    // Strip an optional port for comparison; the wildcard binds to
    // the host, not the port.
    const hostNoPort = host.replace(/:\d+$/, '');
    if (hostNoPort === wildcardDomain) {
        // Bare apex is not matched by `*.example.com` (see comment
        // at the top of the file). Add the apex separately.
        return false;
    }
    return hostNoPort.endsWith(`.${wildcardDomain}`);
}

export function isOriginBlocked(blocklist, origin) {
    if (!Array.isArray(blocklist) || blocklist.length === 0) return false;
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    for (const entry of blocklist) {
        if (typeof entry !== 'string') continue;
        if (parseWildcardPattern(entry)) {
            if (matchesWildcard(normalized, entry)) return true;
            continue;
        }
        if (normalizeOrigin(entry) === normalized) return true;
    }
    return false;
}

async function readSettings(vault) {
    try { return await vault.settings.get(); } catch { return null; }
}

async function writeSettings(vault, next) {
    await vault.settings.put(next);
}

function asList(settings) {
    const list = settings?.blockedOrigins;
    return Array.isArray(list) ? list.slice() : [];
}

// Cluster S FOLLOWUP 4: blocklist audit log. Ring-buffer of recent
// mutations so a security-conscious user (or incident responder) can
// see *what* changed and *when* without having to diff backups. Lives
// in `settings.blocklistAuditLog: AuditEntry[]`. Capped at AUDIT_MAX
// to keep the settings record small; oldest entries fall off when full.
//
// Entry shape:
//   { at: number,       // epoch ms
//     action: 'add' | 'remove',
//     entry: string,    // canonical entry (origin or wildcard)
//     evictedSiteIds?: string[]   // populated on 'add' when sites
//                                  // got evicted as a side effect
//   }

const AUDIT_MAX = 50;

/**
 * @typedef {{ at: number, action: 'add' | 'remove', entry: string, evictedSiteIds?: string[] }} BlocklistAuditEntry
 */

function asAuditList(settings) {
    const list = settings?.blocklistAuditLog;
    return Array.isArray(list) ? list.slice() : [];
}

function trimAudit(list) {
    if (list.length <= AUDIT_MAX) return list;
    return list.slice(list.length - AUDIT_MAX);
}

/**
 * Append a mutation entry to the audit log. Caller is responsible for
 * passing the merged settings record to writeSettings.
 *
 * @param {{ blocklistAuditLog?: BlocklistAuditEntry[] }} settings
 * @param {Omit<BlocklistAuditEntry, 'at'> & { at?: number }} entry
 * @returns {{ blocklistAuditLog: BlocklistAuditEntry[] }}
 */
function withAudit(settings, entry) {
    const list = asAuditList(settings);
    const stamped = {
        at: typeof entry.at === 'number' ? entry.at : Date.now(),
        action: entry.action,
        entry: entry.entry,
        ...(entry.evictedSiteIds && entry.evictedSiteIds.length > 0
            ? { evictedSiteIds: [...entry.evictedSiteIds] }
            : {}),
    };
    list.push(stamped);
    return { blocklistAuditLog: trimAudit(list) };
}

/**
 * Read the audit log (newest-last).
 *
 * @param {{ vault: any }} args
 * @returns {Promise<BlocklistAuditEntry[]>}
 */
export async function listBlocklistAuditLog({ vault }) {
    const settings = await readSettings(vault);
    return asAuditList(settings);
}

/**
 * Wipe the audit log. Used by Settings → Connected Sites "Clear log".
 *
 * @param {{ vault: any }} args
 * @returns {Promise<{ cleared: number }>}
 */
export async function clearBlocklistAuditLog({ vault }) {
    const settings = await readSettings(vault);
    if (!settings) return { cleared: 0 };
    const before = asAuditList(settings).length;
    if (before === 0) return { cleared: 0 };
    await writeSettings(vault, { ...settings, blocklistAuditLog: [] });
    return { cleared: before };
}

/**
 * @param {{ vault: any }} args
 * @returns {Promise<string[]>} sorted origin list
 */
export async function listBlockedOrigins({ vault }) {
    const settings = await readSettings(vault);
    return asList(settings).sort((a, b) => a.localeCompare(b));
}

/**
 * Add an origin or wildcard pattern to the blocklist and delete any
 * matching `ConnectedSite` records so an in-flight session can't keep
 * signing. Idempotent (adding an already-blocked entry is a no-op).
 *
 * Cluster S FOLLOWUP 3: accepts wildcard patterns (`*.example.com`).
 * When the entry is a wildcard, every existing ConnectedSite whose
 * origin matches gets evicted at write time so a previously-approved
 * subdomain can't keep signing.
 *
 * @param {{ vault: any, origin: string }} args
 * @returns {Promise<{ blocked: string, alreadyBlocked: boolean, evictedSiteIds: string[] }>}
 */
export async function addBlockedOrigin({ vault, origin }) {
    const normalized = normalizeBlocklistEntry(origin);
    if (!normalized) {
        throw new Error(`addBlockedOrigin: ${JSON.stringify(origin)} is not a valid origin or wildcard`);
    }
    const settings = await readSettings(vault);
    if (!settings) {
        throw new Error('addBlockedOrigin: settings store unavailable');
    }
    const list = asList(settings);
    const already = list.some((entry) => normalizeBlocklistEntry(entry) === normalized);
    let nextSettings = settings;
    if (!already) {
        list.push(normalized);
        nextSettings = { ...nextSettings, blockedOrigins: list };
    }
    const evictedSiteIds = [];
    if (parseWildcardPattern(normalized)) {
        // Wildcard: fall back to listing all sites + matching them
        // since findBy('origin', ...) only handles exact matches.
        const all = await vault.connectedSites.list();
        for (const site of all) {
            if (matchesWildcard(site.origin, normalized)) {
                await vault.connectedSites.delete(site.id);
                evictedSiteIds.push(site.id);
            }
        }
    } else {
        const sites = await vault.connectedSites.findBy('origin', normalized);
        for (const site of sites) {
            await vault.connectedSites.delete(site.id);
            evictedSiteIds.push(site.id);
        }
    }
    if (!already) {
        // Cluster S FOLLOWUP 4: only audit a real state change. Idempotent
        // re-adds don't pollute the log.
        nextSettings = {
            ...nextSettings,
            ...withAudit(nextSettings, {
                action: 'add',
                entry: normalized,
                evictedSiteIds,
            }),
        };
        await writeSettings(vault, nextSettings);
    }
    return { blocked: normalized, alreadyBlocked: already, evictedSiteIds };
}

/**
 * @param {{ vault: any, origin: string }} args
 * @returns {Promise<{ removed: string | null }>}
 */
export async function removeBlockedOrigin({ vault, origin }) {
    const normalized = normalizeBlocklistEntry(origin);
    if (!normalized) {
        return { removed: null };
    }
    const settings = await readSettings(vault);
    if (!settings) {
        throw new Error('removeBlockedOrigin: settings store unavailable');
    }
    const list = asList(settings);
    const next = list.filter((entry) => normalizeBlocklistEntry(entry) !== normalized);
    if (next.length === list.length) {
        return { removed: null };
    }
    const nextSettings = {
        ...settings,
        blockedOrigins: next,
        ...withAudit(settings, { action: 'remove', entry: normalized }),
    };
    await writeSettings(vault, nextSettings);
    return { removed: normalized };
}
