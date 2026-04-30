// assetInfo — thin read-only wrapper over `sdk.getToken`. Backs the
// §27.6 token detail richer metadata (description, creator, supply,
// lock status, market price) and the §27.5 collectibles image URL
// extraction. Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3.
//
// xchain-explorer's `/api/token/{TICK}` returns a richly nested
// payload (info / supply / locks / market / mints / callback / lists)
// with the original column names. This wrapper normalizes it down to
// the stable surface the wallet's UI needs without leaking the inner
// shape across host boundaries — that way a future explorer schema
// addition (e.g. exposing `decimals` once xchain-explorer drops the
// strip) doesn't require renderer-side changes to consume.

/**
 * @typedef {Object} AssetInfo
 * @property {string} chainId
 * @property {string} asset                            ticker (uppercase canonical)
 * @property {string | null} description
 * @property {string | null} creator                   issuer address
 * @property {string | null} totalSupply               formatted decimal string ("1000.5")
 * @property {string | null} maxSupply                 formatted decimal string, null if unlimited
 * @property {boolean} locked                          true when description/supply/mint is locked
 * @property {Object} locks                            full lock map (per-field booleans)
 * @property {number | null} marketPrice               coin-denominated price, null if unset
 * @property {number | null} marketFloor               coin-denominated floor, null if unset
 * @property {string | null} imageUrl                  best-effort image URL extracted from description
 */

/**
 * Try to extract an image URL from a token's free-form description.
 * Tokens commonly carry a JSON blob, a markdown image, or a bare URL
 * pointing at an off-chain asset (IPFS gateway, https). We accept any
 * of those forms and reject anything that isn't an http(s) or ipfs URL.
 *
 * @param {string | null | undefined} description
 * @returns {string | null}
 */
export function extractImageUrl(description) {
    if (!description || typeof description !== 'string') return null;
    const trimmed = description.trim();
    if (!trimmed) return null;
    // JSON object with `image` / `imageUrl` / `image_url` keys.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            const obj = Array.isArray(parsed) ? parsed[0] : parsed;
            if (obj && typeof obj === 'object') {
                const candidate = obj.image || obj.imageUrl || obj.image_url || null;
                if (typeof candidate === 'string') {
                    return normalizeImageUrl(candidate);
                }
            }
        } catch {
            // fall through to other strategies
        }
    }
    // Markdown image syntax: ![alt](url)
    const md = /!\[[^\]]*\]\((https?:\/\/[^)\s]+|ipfs:\/\/[^)\s]+)\)/i.exec(trimmed);
    if (md && md[1]) return normalizeImageUrl(md[1]);
    // Bare URL with an image extension somewhere in the description.
    const bare = /\b(https?:\/\/\S+?\.(?:png|jpe?g|gif|svg|webp|avif))(?:[?#]\S*)?\b/i.exec(trimmed);
    if (bare && bare[1]) return normalizeImageUrl(bare[1]);
    // Bare ipfs:// URL.
    const ipfs = /\b(ipfs:\/\/[A-Za-z0-9]+(?:\/[\S]+)?)/i.exec(trimmed);
    if (ipfs && ipfs[1]) return normalizeImageUrl(ipfs[1]);
    return null;
}

/**
 * Map ipfs:// to a public gateway so an <img> tag can render it. https
 * URLs pass through unchanged.
 * @param {string} url
 */
function normalizeImageUrl(url) {
    if (!url) return null;
    const t = url.trim();
    if (t.startsWith('ipfs://')) {
        return 'https://ipfs.io/ipfs/' + t.slice('ipfs://'.length);
    }
    if (/^https?:\/\//i.test(t)) return t;
    return null;
}

/**
 * Normalize the explorer's `getToken` response into the stable
 * `AssetInfo` shape the wallet renderer consumes.
 * @param {string} chainId
 * @param {string} asset
 * @param {any} raw
 * @returns {AssetInfo}
 */
export function normalizeAssetInfo(chainId, asset, raw) {
    // explorer wraps the result in a single-element array; SDK returns
    // it through unchanged. Empty / null payloads (asset not found)
    // collapse into a sentinel "no metadata" record so the caller can
    // render "No description" instead of having to special-case shape.
    const row = Array.isArray(raw) ? raw[0] : raw;
    const description = row?.info?.description ?? null;
    const creator = row?.info?.owner ?? null;
    const totalSupply = row?.supply?.current != null ? String(row.supply.current) : null;
    const maxSupply = row?.supply?.max != null ? String(row.supply.max) : null;
    const lockMap = row?.locks && typeof row.locks === 'object' ? row.locks : {};
    // The wallet's "locked" headline reads as true when any structural
    // mutability is gated — description, supply ceiling, mint, or
    // existing-supply mint. callback / sleep / list are policy locks
    // that don't change the token's identity surface, so leave them out
    // of the headline. Per-field detail still comes through `locks`.
    const locked = !!(
        lockMap.description
        || lockMap.max_supply
        || lockMap.mint
        || lockMap.mint_supply
    );
    const marketPrice = isFiniteNum(row?.market?.price) ? row.market.price : null;
    const marketFloor = isFiniteNum(row?.market?.floor) ? row.market.floor : null;
    return {
        chainId,
        asset,
        description,
        creator,
        totalSupply,
        maxSupply,
        locked,
        locks: lockMap,
        marketPrice,
        marketFloor,
        imageUrl: extractImageUrl(description),
    };
}

function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Fetch normalized asset metadata for a (chainId, asset) pair.
 * Native coins (BTC / LTC / DOGE) and unknown tickers gracefully
 * resolve to a sentinel record rather than raising — the renderer
 * already gates `<TokenDetail>` on `kind !== 'native'` for the panels
 * that consume this data, but a no-data record keeps host call sites
 * uniform.
 *
 * @param {Object} params
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} params.sdkRegistry
 * @param {string} params.chainId
 * @param {string} params.asset
 * @returns {Promise<AssetInfo>}
 */
export async function assetInfoFor({ sdkRegistry, chainId, asset }) {
    if (!sdkRegistry) throw new Error('assetInfoFor: sdkRegistry is required');
    if (!chainId) throw new Error('assetInfoFor: chainId is required');
    if (!asset) throw new Error('assetInfoFor: asset is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getToken !== 'function') {
        return normalizeAssetInfo(chainId, asset, null);
    }
    try {
        const raw = await sdk.getToken(asset);
        return normalizeAssetInfo(chainId, asset, raw);
    } catch (err) {
        // Asset not found / explorer offline / network glitch — return
        // the sentinel rather than raising; the renderer wraps the
        // missing metadata in "No description" copy and keeps the rest
        // of the panel functional.
        return normalizeAssetInfo(chainId, asset, null);
    }
}
