// Origin blocklist (§12 / G009). User-managed list of origins that
// should be hard-rejected at the bridge boundary — `bridge.connect`
// short-circuits, and the four sign methods reject before going to
// approvals.
//
// "Allowlist" semantics live elsewhere: a `ConnectedSite` record
// already gates whether a site has been approved at all (the absence
// of a record means an origin must call `connect()` and get user
// approval). The blocklist is the explicit complement — an origin
// listed here can never connect or sign even if it previously had
// approval, until the user removes it.
//
// Storage shape: `settings.blockedOrigins: string[]`, v2-tolerant.
// Each entry is an `URL.origin`-form string ("https://example.com",
// "http://localhost:3000"). Bare hosts are normalized to `https://`
// at write time so case + protocol comparisons stay simple.

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

export function isOriginBlocked(blocklist, origin) {
    if (!Array.isArray(blocklist) || blocklist.length === 0) return false;
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    for (const entry of blocklist) {
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

/**
 * @param {{ vault: any }} args
 * @returns {Promise<string[]>} sorted origin list
 */
export async function listBlockedOrigins({ vault }) {
    const settings = await readSettings(vault);
    return asList(settings).sort((a, b) => a.localeCompare(b));
}

/**
 * Add an origin to the blocklist and delete any existing
 * `ConnectedSite` record so an in-flight session can't keep signing.
 * Idempotent — adding an already-blocked origin is a no-op.
 *
 * @param {{ vault: any, origin: string }} args
 * @returns {Promise<{ blocked: string, alreadyBlocked: boolean, evictedSiteIds: string[] }>}
 */
export async function addBlockedOrigin({ vault, origin }) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) {
        throw new Error(`addBlockedOrigin: ${JSON.stringify(origin)} is not a valid origin`);
    }
    const settings = await readSettings(vault);
    if (!settings) {
        throw new Error('addBlockedOrigin: settings store unavailable');
    }
    const list = asList(settings);
    const already = list.some((entry) => normalizeOrigin(entry) === normalized);
    if (!already) {
        list.push(normalized);
        await writeSettings(vault, { ...settings, blockedOrigins: list });
    }
    const sites = await vault.connectedSites.findBy('origin', normalized);
    const evictedSiteIds = [];
    for (const site of sites) {
        await vault.connectedSites.delete(site.id);
        evictedSiteIds.push(site.id);
    }
    return { blocked: normalized, alreadyBlocked: already, evictedSiteIds };
}

/**
 * @param {{ vault: any, origin: string }} args
 * @returns {Promise<{ removed: string | null }>}
 */
export async function removeBlockedOrigin({ vault, origin }) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) {
        return { removed: null };
    }
    const settings = await readSettings(vault);
    if (!settings) {
        throw new Error('removeBlockedOrigin: settings store unavailable');
    }
    const list = asList(settings);
    const next = list.filter((entry) => normalizeOrigin(entry) !== normalized);
    if (next.length === list.length) {
        return { removed: null };
    }
    await writeSettings(vault, { ...settings, blockedOrigins: next });
    return { removed: normalized };
}
