// assetInfo — read-only wrapper over `sdk.getToken`. Backs the §27.6
// token detail richer metadata (description, creator, supply, lock
// status, market price), the §27.5 collectibles image URL extraction,
// and the §27.6 Token Information Standard (TIS) gallery — images,
// audio, video, website, social links, files — when the token's
// description is a URL pointing at a TIS JSON document.
//
// xchain-explorer's `/api/token/{TICK}` returns a richly nested
// payload (info / supply / locks / market / mints / callback / lists)
// with the original column names. This wrapper normalizes it down to
// the stable surface the wallet's UI needs without leaking the inner
// shape across host boundaries — that way a future explorer schema
// addition (e.g. exposing `decimals` once xchain-explorer drops the
// strip) doesn't require renderer-side changes to consume.
//
// When the on-chain `description` is a URL (https / ipfs / ar / ord),
// the wallet fetches the JSON document and merges TIS v1.0.0 fields
// (or legacy CoinDaddy fields converted via `legacyJsonToTis`) onto
// the normalized TokenInfo. Raw `html` content from the TIS document
// is explicitly dropped — the wallet popup holds keys, so we don't
// render author-supplied HTML even sandboxed.

/**
 * @typedef {Object} TisMediaEntry
 * @property {string} url                                full https URL after scheme rewrite
 * @property {string | null} type                        extension or TIS-supplied type ("png" / "icon" / "mp4" / …)
 * @property {string | null} name                        human-readable label when the TIS document provides one
 */

/**
 * @typedef {Object} TisSocialEntry
 * @property {string} platform                           "facebook" / "github" / "twitter" / "reddit" / "linkedin" / "url" / …
 * @property {string} url                                rendered as the link href
 */

/**
 * @typedef {Object} TisFileEntry
 * @property {string} url
 * @property {string | null} name
 * @property {string | null} type
 */

/**
 * @typedef {Object} TokenInfo
 * @property {string} chainId
 * @property {string} tick                              ticker (uppercase canonical)
 * @property {string | null} description                 free-form description text (TIS body if present, else on-chain)
 * @property {string | null} creator                     issuer address
 * @property {string | null} totalSupply                 formatted decimal string ("1000.5")
 * @property {string | null} maxSupply                   formatted decimal string, null if unlimited
 * @property {boolean} locked                            true when description/supply/mint is locked
 * @property {Object} locks                              full lock map (per-field booleans)
 * @property {number | null} marketPrice                 coin-denominated price, null if unset
 * @property {number | null} marketFloor                 coin-denominated floor, null if unset
 * @property {string | null} imageUrl                    best-effort hero image URL (TIS images[0] if present, else regex from description)
 * @property {TisMediaEntry[]} images                    full image gallery (icon / standard / large / hires)
 * @property {TisMediaEntry[]} audio                     audio tracks
 * @property {TisMediaEntry[]} video                     video tracks
 * @property {string | null} website                     primary website URL
 * @property {TisSocialEntry[]} socials                  social links (twitter / github / reddit / …)
 * @property {TisFileEntry[]} files                      arbitrary file attachments
 * @property {string | null} category                    primary category from TIS
 */

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'];
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'ogg', 'flac'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'wmv'];

/**
 * Try to extract an image URL from a token's free-form description.
 * Tokens commonly carry a JSON blob, a markdown image, or a bare URL
 * pointing at an off-chain tick (IPFS gateway, https). We accept any
 * of those forms and reject anything that isn't an http(s) or ipfs URL.
 *
 * @param {string | null | undefined} description
 * @returns {string | null}
 */
export function extractImageUrl(description) {
    if (!description || typeof description !== 'string') return null;
    const trimmed = description.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            const obj = Array.isArray(parsed) ? parsed[0] : parsed;
            if (obj && typeof obj === 'object') {
                const candidate = obj.image || obj.imageUrl || obj.image_url || null;
                if (typeof candidate === 'string') {
                    return normalizeMediaUrl(candidate);
                }
            }
        } catch {
            // fall through to other strategies
        }
    }
    const md = /!\[[^\]]*\]\((https?:\/\/[^)\s]+|ipfs:\/\/[^)\s]+)\)/i.exec(trimmed);
    if (md && md[1]) return normalizeMediaUrl(md[1]);
    const bare = /\b(https?:\/\/\S+?\.(?:png|jpe?g|gif|svg|webp|avif))(?:[?#]\S*)?\b/i.exec(trimmed);
    if (bare && bare[1]) return normalizeMediaUrl(bare[1]);
    const ipfs = /\b(ipfs:\/\/[A-Za-z0-9]+(?:\/[\S]+)?)/i.exec(trimmed);
    if (ipfs && ipfs[1]) return normalizeMediaUrl(ipfs[1]);
    return null;
}

/**
 * Map ipfs:// / ar: / ord: schemes to public gateways. https URLs pass
 * through unchanged. Returns null for anything we can't safely render.
 *
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
function normalizeMediaUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const t = url.trim();
    if (!t) return null;
    if (t.startsWith('ipfs://')) {
        return 'https://ipfs.io/ipfs/' + t.slice('ipfs://'.length);
    }
    if (/^ar:/i.test(t)) {
        return 'https://arweave.net/' + t.replace(/^ar:/i, '');
    }
    if (/^https?:\/\//i.test(t)) return t;
    return null;
}

/**
 * Detect the format of a description string for the TIS-fetch path.
 * Returns the canonical JSON URL when one can be derived; otherwise null
 * (description is plain text, no fetch).
 *
 * @param {string | null | undefined} description
 * @returns {string | null}
 */
export function descriptionJsonUrl(description) {
    if (!description || typeof description !== 'string') return null;
    let t = description.trim();
    if (!t) return null;
    // Strip ;title suffix used by the legacy shorthand
    // ("https://.../JDOG.json;JDOG token info").
    const semi = t.indexOf(';');
    if (semi > 0 && /^https?:\/\//i.test(t)) {
        t = t.slice(0, semi).trim();
    }
    // Arweave gateway "/x.json" suffix trick — drop it; the gateway 404s.
    t = t.replace(/^(https?:\/\/arweave\.net\/[^\/?#]+)\/x\.json$/i, '$1');
    if (/^ipfs:\/\//i.test(t)) {
        return 'https://ipfs.io/ipfs/' + t.slice('ipfs://'.length);
    }
    if (/^ar:/i.test(t)) {
        return 'https://arweave.net/' + t.replace(/^ar:/i, '');
    }
    if (/^https?:\/\/arweave\.net\//i.test(t)) return t;
    if (/^https?:\/\//i.test(t) && /\.json(?:[?#]|$)/i.test(t)) return t;
    // Bare "host/path.json" — promote to https.
    if (/^[^\s/]+\.[^\s/]+\/.+\.json(?:[?#]|$)/i.test(t)) {
        return 'https://' + t;
    }
    return null;
}

/**
 * Adapter for legacy CoinDaddy-style metadata JSONs that predate the
 * Token Information Standard. Mirrors xchain-explorer's
 * `legacyJsonToXChainTIS` so wallet-side rendering doesn't have to
 * special-case the older shape. Returns the same record shape as a
 * native TIS document.
 *
 * @param {any} raw
 */
export function legacyJsonToTis(raw) {
    const o = (raw && typeof raw === 'object') ? { ...raw } : {};
    // "icon" is a common typo for "image" in community JSONs.
    if (o.icon && !o.image) o.image = o.icon;
    const out = /** @type {any} */ ({});
    for (const k of ['token', 'name', 'description', 'website', 'pgpsig']) {
        if (o[k]) out[k] = o[k];
    }
    out.owner = (o.owner && typeof o.owner === 'object') ? o.owner : {};
    out.contacts = Array.isArray(o.contacts) ? [...o.contacts] : [];
    out.categories = Array.isArray(o.categories) ? [...o.categories] : [];
    out.social = Array.isArray(o.social) ? [...o.social] : [];
    out.images = Array.isArray(o.images) ? [...o.images] : [];
    out.audio = Array.isArray(o.audio) ? [...o.audio] : [];
    out.video = Array.isArray(o.video) ? [...o.video] : [];
    out.files = Array.isArray(o.files) ? [...o.files] : [];
    if (o.image) {
        const present = out.images.some((x) => x && x.data === o.image);
        if (!present) out.images.push({ type: 'icon', data: o.image });
    }
    if (o.image_large) out.images.push({ type: 'large', name: o.image_title, data: o.image_large });
    if (o.image_large_hd) out.images.push({ type: 'hires', name: o.image_title, data: o.image_large_hd });
    if (typeof o.audio === 'string' && o.audio) {
        out.audio.push({ type: o.audio.slice(-3), data: o.audio });
    }
    if (typeof o.video === 'string' && o.video) {
        out.video.push({ type: o.video.slice(-3), data: o.video });
    }
    const pushSocial = (platform, val) => {
        if (val && typeof val === 'string') out.social.push({ type: platform, data: val });
    };
    pushSocial('facebook', o.website_social_facebook);
    pushSocial('github', o.website_social_github);
    pushSocial('twitter', o.website_social_twitter);
    pushSocial('reddit', o.website_social_reddit);
    pushSocial('linkedin', o.website_social_linkedin);
    if (o.category) out.categories.push({ type: 'main', data: o.category });
    if (o.subcategory) out.categories.push({ type: 'sub', data: o.subcategory });
    return out;
}

function classifyByExtension(url) {
    const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url);
    if (!m) return null;
    const ext = m[1].toLowerCase();
    if (IMAGE_EXTS.includes(ext)) return { kind: 'image', ext };
    if (AUDIO_EXTS.includes(ext)) return { kind: 'audio', ext };
    if (VIDEO_EXTS.includes(ext)) return { kind: 'video', ext };
    return null;
}

function tisEntryToMedia(entry) {
    if (!entry) return null;
    const data = typeof entry === 'string' ? entry : entry.data;
    const url = normalizeMediaUrl(data);
    if (!url) return null;
    return {
        url,
        type: (entry && typeof entry === 'object' && entry.type) ? String(entry.type) : null,
        name: (entry && typeof entry === 'object' && entry.name) ? String(entry.name) : null,
    };
}

/**
 * Translate a TIS-shaped document (or a legacy CoinDaddy JSON normalized
 * via legacyJsonToTis) into the wallet's flat media/links/files arrays.
 *
 * @param {any} doc                                      TIS or legacy-normalized record
 * @returns {{
 *   description: string | null,
 *   images: TisMediaEntry[],
 *   audio: TisMediaEntry[],
 *   video: TisMediaEntry[],
 *   website: string | null,
 *   socials: TisSocialEntry[],
 *   files: TisFileEntry[],
 *   category: string | null
 * }}
 */
export function tisToMediaBundle(doc) {
    const empty = {
        description: null,
        images: /** @type {TisMediaEntry[]} */ ([]),
        audio: /** @type {TisMediaEntry[]} */ ([]),
        video: /** @type {TisMediaEntry[]} */ ([]),
        website: null,
        socials: /** @type {TisSocialEntry[]} */ ([]),
        files: /** @type {TisFileEntry[]} */ ([]),
        category: null,
    };
    if (!doc || typeof doc !== 'object') return empty;
    const images = (Array.isArray(doc.images) ? doc.images : [])
        .map(tisEntryToMedia).filter(Boolean);
    // Promote bare audio[]/video[]/files[] strings the same way.
    const audio = (Array.isArray(doc.audio) ? doc.audio : [])
        .map(tisEntryToMedia).filter(Boolean);
    const video = (Array.isArray(doc.video) ? doc.video : [])
        .map(tisEntryToMedia).filter(Boolean);
    // Extract URLs embedded in the prose so audio/video files mentioned
    // inline still surface (mirrors the explorer's permissive behavior).
    const inline = extractMediaUrlsFromText(typeof doc.description === 'string' ? doc.description : '');
    for (const u of inline.images) {
        if (!images.some((x) => x.url === u.url)) images.push(u);
    }
    for (const u of inline.audio) {
        if (!audio.some((x) => x.url === u.url)) audio.push(u);
    }
    for (const u of inline.video) {
        if (!video.some((x) => x.url === u.url)) video.push(u);
    }
    const files = (Array.isArray(doc.files) ? doc.files : [])
        .map((f) => {
            if (!f) return null;
            const data = typeof f === 'string' ? f : f.data;
            const url = normalizeMediaUrl(data);
            if (!url) return null;
            return {
                url,
                name: (f && typeof f === 'object' && f.name) ? String(f.name) : null,
                type: (f && typeof f === 'object' && f.type) ? String(f.type) : null,
            };
        })
        .filter(Boolean);
    const socials = (Array.isArray(doc.social) ? doc.social : [])
        .map((s) => {
            if (!s || typeof s !== 'object') return null;
            const url = normalizeMediaUrl(s.data);
            if (!url) return null;
            return { platform: String(s.type || 'url'), url };
        })
        .filter(Boolean);
    const website = typeof doc.website === 'string' ? normalizeMediaUrl(doc.website) : null;
    const description = typeof doc.description === 'string' ? doc.description : null;
    const categoryEntry = Array.isArray(doc.categories)
        ? doc.categories.find((c) => c && c.type === 'main')
        : null;
    const category = categoryEntry && typeof categoryEntry.data === 'string'
        ? categoryEntry.data
        : null;
    return { description, images, audio, video, website, socials, files, category };
}

function extractMediaUrlsFromText(text) {
    const out = { images: [], audio: [], video: [] };
    if (!text || typeof text !== 'string') return out;
    const urls = text.match(/https?:\/\/[^\s"'<>)]+/gi);
    if (!urls) return out;
    for (const raw of urls) {
        const cls = classifyByExtension(raw);
        if (!cls) continue;
        const url = normalizeMediaUrl(raw);
        if (!url) continue;
        const entry = { url, type: cls.ext, name: null };
        if (cls.kind === 'image') out.images.push(entry);
        else if (cls.kind === 'audio') out.audio.push(entry);
        else if (cls.kind === 'video') out.video.push(entry);
    }
    return out;
}

/**
 * Normalize the explorer's `getToken` response into the stable
 * `TokenInfo` shape the wallet renderer consumes. Optionally merges a
 * fetched TIS document onto the result via `tisBundle`.
 *
 * @param {string} chainId
 * @param {string} tick
 * @param {any} raw                                     explorer row
 * @param {ReturnType<typeof tisToMediaBundle> | null} [tisBundle]
 * @returns {TokenInfo}
 */
export function normalizeTokenInfo(chainId, tick, raw, tisBundle = null) {
    const row = Array.isArray(raw) ? raw[0] : raw;
    const onChainDescription = row?.info?.description ?? null;
    const creator = row?.info?.owner ?? null;
    const totalSupply = row?.supply?.current != null ? String(row.supply.current) : null;
    const maxSupply = row?.supply?.max != null ? String(row.supply.max) : null;
    const lockMap = row?.locks && typeof row.locks === 'object' ? row.locks : {};
    const locked = !!(
        lockMap.description
        || lockMap.max_supply
        || lockMap.mint
        || lockMap.mint_supply
    );
    const marketPrice = isFiniteNum(row?.market?.price) ? row.market.price : null;
    const marketFloor = isFiniteNum(row?.market?.floor) ? row.market.floor : null;
    // TIS bundle (when fetched) supplies the richer description body and
    // media arrays. We keep the on-chain description string as a fallback
    // for the description text, but prefer the TIS body when available
    // since it's usually the human-readable version. The hero `imageUrl`
    // falls back to the regex extractor for tokens that didn't bother
    // with a TIS document.
    const description = tisBundle?.description || onChainDescription;
    const images = tisBundle?.images || [];
    const audio = tisBundle?.audio || [];
    const video = tisBundle?.video || [];
    const website = tisBundle?.website || null;
    const socials = tisBundle?.socials || [];
    const files = tisBundle?.files || [];
    const category = tisBundle?.category || null;
    const imageUrl = (images.length > 0 && images[0]?.url)
        || extractImageUrl(onChainDescription);
    return {
        chainId,
        tick,
        description,
        creator,
        totalSupply,
        maxSupply,
        locked,
        locks: lockMap,
        marketPrice,
        marketFloor,
        imageUrl,
        images,
        audio,
        video,
        website,
        socials,
        files,
        category,
    };
}

function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Fetch a token's TIS document (or legacy CoinDaddy JSON) and convert it
 * into the wallet's media bundle. Returns null when the description
 * isn't a URL, the fetch fails, the response isn't JSON, or the document
 * is empty. Never raises — the renderer falls back to the on-chain
 * description string when this returns null.
 *
 * @param {object} args
 * @param {string} args.description                      on-chain description string
 * @param {typeof fetch} args.fetch                      injected for testability
 * @param {AbortSignal} [args.signal]                    cancels in-flight fetch
 * @returns {Promise<ReturnType<typeof tisToMediaBundle> | null>}
 */
export async function fetchTisBundle({ description, fetch: fetchImpl, signal }) {
    const jsonUrl = descriptionJsonUrl(description);
    if (!jsonUrl || typeof fetchImpl !== 'function') return null;
    try {
        const resp = await fetchImpl(jsonUrl, { signal, redirect: 'follow' });
        if (!resp || !resp.ok) return null;
        const text = await resp.text();
        const trimmed = text.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
        let parsed;
        try { parsed = JSON.parse(trimmed); } catch { return null; }
        // The legacy adapter is idempotent for native TIS docs (already
        // has images[]/audio[]/video[]/social[]), so we run it
        // unconditionally to handle both shapes.
        const tis = legacyJsonToTis(parsed);
        return tisToMediaBundle(tis);
    } catch {
        return null;
    }
}

/**
 * Fetch normalized tick metadata for a (chainId, tick) pair. Native
 * coins and unknown tickers gracefully resolve to a sentinel record
 * rather than raising.
 *
 * When `metadataFetchEnabled` is true (default), the description-as-URL
 * path is followed and the TIS gallery is included; when false, only
 * the indexer's on-chain row is normalized and the gallery comes back
 * empty. This lets `settings.privacy.metadataFetchEnabled = false`
 * keep the wallet quiet at the network layer.
 *
 * @param {Object} params
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} params.sdkRegistry
 * @param {string} params.chainId
 * @param {string} params.tick
 * @param {boolean} [params.metadataFetchEnabled]
 * @param {typeof fetch} [params.fetch]
 * @returns {Promise<TokenInfo>}
 */
export async function tokenInfoFor({
    sdkRegistry,
    chainId,
    tick,
    metadataFetchEnabled = true,
    fetch: fetchImpl,
}) {
    if (!sdkRegistry) throw new Error('tokenInfoFor: sdkRegistry is required');
    if (!chainId) throw new Error('tokenInfoFor: chainId is required');
    if (!tick) throw new Error('tokenInfoFor: tick is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getToken !== 'function') {
        return normalizeTokenInfo(chainId, tick, null);
    }
    let raw = null;
    try {
        raw = await sdk.getToken(tick);
    } catch {
        return normalizeTokenInfo(chainId, tick, null);
    }
    let tisBundle = null;
    if (metadataFetchEnabled) {
        const row = Array.isArray(raw) ? raw[0] : raw;
        const description = row?.info?.description;
        const resolvedFetch = fetchImpl
            || (typeof fetch === 'function' ? fetch : null);
        if (description && resolvedFetch) {
            tisBundle = await fetchTisBundle({
                description,
                fetch: resolvedFetch,
            });
        }
    }
    return normalizeTokenInfo(chainId, tick, raw, tisBundle);
}
