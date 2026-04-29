// §18.4 / Cluster N FOLLOWUP 1 — runtime fetch of the firmware
// manifest with bundled fallback.
//
// The wallet bundles a `FIRMWARE_MANIFEST` at build time so every
// release pins its own safety baseline. Between releases, advisories
// published upstream (Trezor / Ledger CVE notices, vendor support
// matrix changes) can be picked up at runtime by fetching a signed
// JSON manifest from `FIRMWARE_MANIFEST_URL`, verifying it against
// `FIRMWARE_MANIFEST_PUBLIC_KEY`, and writing the verified payload to
// a per-shell cache. `resolveActiveFirmwareManifest` then prefers the
// cached manifest when it is fresh (within `FIRMWARE_MANIFEST_TTL_MS`)
// and falls back to the bundled baseline otherwise.
//
// This module is the orchestrator. It is shell-agnostic — the
// signature verifier, fetch implementation, cache backend, and clock
// are all injectable. The extension's chrome.storage.local, the web
// shell's IndexedDB, and the desktop shell's userData each plug their
// own backend in via `createFirmwareManifestCache(...)`. Smokes inject
// in-memory stubs.
//
// Failure modes are deliberately graceful:
//   - Empty URL / public key      → `{ ok: false, reason: 'not-configured' }`
//   - Network failure             → `{ ok: false, reason: 'network', error }`
//   - Signature verification fail → `{ ok: false, reason: 'signature' }`
//   - Schema mismatch             → `{ ok: false, reason: 'schema' }`
// The cache is never written on failure; the resolver therefore keeps
// using the previous cached payload (or the bundled baseline) — a
// compromised CDN cannot push a downgrade-to-no-advisories.
//
// Structurally, the verified payload looks like:
//
//   { manifest: <FIRMWARE_MANIFEST shape>, signature: '<base64>' }
//
// where the signature covers a deterministic JSON encoding of the
// `manifest` object. Verifiers are pluggable so smokes don't have to
// stand up real Ed25519.

import {
    FIRMWARE_MANIFEST_URL,
    FIRMWARE_MANIFEST_PUBLIC_KEY,
    FIRMWARE_MANIFEST_TTL_MS,
} from '../buildInfo.js';
import { FIRMWARE_MANIFEST } from '../signers/firmware-manifest.js';

const SCHEMA_ID = 'firmware-manifest/1';
const CACHE_KEY = 'xc.firmwareManifest';

/**
 * @typedef {Object} ManifestEnvelope
 * @property {object} manifest
 * @property {string} signature   base64 signature of canonicalized manifest
 */

/**
 * @typedef {Object} CachedEntry
 * @property {object} manifest        verified manifest body
 * @property {string} signature       signature, kept for audit
 * @property {number} fetchedAt       Date.now() at write time
 */

/**
 * @typedef {Object} CacheBackend
 * @property {(key: string) => Promise<CachedEntry | null>} get
 * @property {(key: string, value: CachedEntry) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 */

/**
 * Refresh the cached firmware manifest from the configured URL.
 *
 * @param {{
 *   fetch?: typeof fetch,
 *   verify: (envelope: ManifestEnvelope, publicKey: string) => Promise<boolean>,
 *   cache: CacheBackend,
 *   url?: string,
 *   publicKey?: string,
 *   now?: () => number,
 * }} deps
 * @returns {Promise<
 *   | { ok: true, manifest: object, source: 'fetched' }
 *   | { ok: false, reason: 'not-configured' | 'network' | 'signature' | 'schema', error?: Error }
 * >}
 */
export async function refreshFirmwareManifest(deps) {
    const url = deps.url ?? FIRMWARE_MANIFEST_URL;
    const publicKey = deps.publicKey ?? FIRMWARE_MANIFEST_PUBLIC_KEY;
    if (!url || !publicKey) {
        return { ok: false, reason: 'not-configured' };
    }
    const fetchImpl = deps.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        return { ok: false, reason: 'network', error: new Error('fetch is not available') };
    }
    let envelope;
    try {
        const resp = await fetchImpl(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        if (!resp || !resp.ok) {
            return {
                ok: false,
                reason: 'network',
                error: new Error(`firmware manifest fetch failed: HTTP ${resp?.status ?? '?'}`),
            };
        }
        envelope = await resp.json();
    } catch (err) {
        return { ok: false, reason: 'network', error: err };
    }
    if (!envelope || typeof envelope !== 'object'
        || !envelope.manifest || typeof envelope.manifest !== 'object'
        || typeof envelope.signature !== 'string'
        || envelope.signature.length === 0) {
        return { ok: false, reason: 'schema' };
    }
    if (envelope.manifest.schema !== SCHEMA_ID) {
        return { ok: false, reason: 'schema' };
    }
    let valid;
    try {
        valid = await deps.verify(envelope, publicKey);
    } catch (_err) {
        valid = false;
    }
    if (!valid) {
        return { ok: false, reason: 'signature' };
    }
    const now = (deps.now ?? Date.now)();
    /** @type {CachedEntry} */
    const entry = {
        manifest: envelope.manifest,
        signature: envelope.signature,
        fetchedAt: now,
    };
    await deps.cache.put(CACHE_KEY, entry);
    return { ok: true, manifest: envelope.manifest, source: 'fetched' };
}

/**
 * Resolve the active firmware manifest. Cache hit within TTL → use
 * cached payload. Cache miss / expired → fall back to the bundled
 * baseline. The verdict's `source` distinguishes 'cache' from
 * 'bundled' so the UI can surface "advisory data is X days old".
 *
 * Stale (out-of-TTL) cache entries are NOT silently used — they're
 * treated identically to cache miss because the CDN may have been
 * unreachable for an extended period and a network failure must not
 * silently downgrade safety. `checkFirmware` consumers can render
 * `unknown` for surfaces where a stale-cache verdict matters.
 *
 * @param {{
 *   cache: CacheBackend,
 *   now?: () => number,
 *   ttlMs?: number,
 * }} deps
 * @returns {Promise<{
 *   manifest: object,
 *   source: 'cache' | 'bundled',
 *   fetchedAt: number | null,
 *   ageMs: number | null,
 *   fresh: boolean,
 * }>}
 */
export async function resolveActiveFirmwareManifest(deps) {
    const cache = deps.cache;
    const now = (deps.now ?? Date.now)();
    const ttlMs = deps.ttlMs ?? FIRMWARE_MANIFEST_TTL_MS;
    let entry = null;
    if (cache && typeof cache.get === 'function') {
        try {
            entry = await cache.get(CACHE_KEY);
        } catch (_err) {
            entry = null;
        }
    }
    if (entry && typeof entry.fetchedAt === 'number') {
        const ageMs = now - entry.fetchedAt;
        if (ageMs >= 0 && ageMs <= ttlMs && entry.manifest && typeof entry.manifest === 'object') {
            return {
                manifest: entry.manifest,
                source: 'cache',
                fetchedAt: entry.fetchedAt,
                ageMs,
                fresh: true,
            };
        }
    }
    return {
        manifest: FIRMWARE_MANIFEST,
        source: 'bundled',
        fetchedAt: null,
        ageMs: null,
        fresh: false,
    };
}

/**
 * In-memory cache backend for tests, fallback shells, and the lightweight
 * "no chrome.storage" cases. Persists for the lifetime of the JS context.
 *
 * @returns {CacheBackend}
 */
export function createInMemoryFirmwareManifestCache() {
    const store = new Map();
    return {
        async get(key) { return store.has(key) ? store.get(key) : null; },
        async put(key, value) { store.set(key, value); },
        async delete(key) { store.delete(key); },
    };
}

export const FIRMWARE_MANIFEST_CACHE_KEY = CACHE_KEY;
