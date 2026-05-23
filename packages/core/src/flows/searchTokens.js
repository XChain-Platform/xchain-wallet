// Substring token search across a single chain. Backs ReceivePicker's
// "On the platform" discovery section so typing a partial ticker like
// "PEPE" surfaces every matching token (PEPECREATURE, PEPECASH, …)
// even when the wallet holds zero balance of any of them.
//
// Wraps xchain-sdk's `getTokens(query, 'token')`, which hits the
// explorer's `/{COIN}/api/tokens/{QUERY}/token` endpoint. That endpoint
// does a `LIKE '%QUERY%'` against the `index_tickers.tick` column —
// good enough for type-ahead today; if it gets slow we can swap to a
// dedicated prefix endpoint without touching the renderer.
//
// Returns a flat, renderer-friendly list. Empty array on any failure
// (network error, unconfigured SDK, dev-mock fallback) — the picker
// just shows fewer rows rather than surfacing an error.

/**
 * @typedef {Object} PlatformTokenHit
 * @property {string} tick                       canonical ticker (uppercase)
 * @property {string | null} totalSupply         circulating supply as a string, or null
 * @property {string | null} maxSupply           cap as a string, or null
 */

/**
 * @param {Object} params
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} params.sdkRegistry
 * @param {string} params.chainId
 * @param {string} params.query                  substring to search for (case-insensitive on the server)
 * @param {number} [params.limit]                cap (clamped to [1, 50]); defaults to 20
 * @returns {Promise<PlatformTokenHit[]>}
 */
export async function searchPlatformTokens({ sdkRegistry, chainId, query, limit = 20 }) {
    if (!sdkRegistry) throw new Error('searchPlatformTokens: sdkRegistry is required');
    if (!chainId) throw new Error('searchPlatformTokens: chainId is required');
    if (typeof query !== 'string' || query.trim().length === 0) return [];
    const trimmed = query.trim();
    const cappedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getTokens !== 'function') return [];
    let raw;
    try {
        raw = await sdk.getTokens(trimmed, 'token', { limit: cappedLimit });
    } catch {
        return [];
    }
    // Explorer wraps records in `{data: [...]}`; the dev-mock SDK
    // proxy returns a bare `[]`. Accept either.
    const rows = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.data) ? raw.data : []);
    const out = /** @type {PlatformTokenHit[]} */ ([]);
    for (const row of rows) {
        if (!row || typeof row.tick !== 'string' || !row.tick) continue;
        out.push({
            tick: row.tick.toUpperCase(),
            totalSupply: row.supply != null ? String(row.supply) : null,
            maxSupply: row.max_supply != null ? String(row.max_supply) : null,
        });
    }
    return out;
}
