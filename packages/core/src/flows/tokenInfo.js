// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

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
 * @typedef {Object} TisOwner
 * @property {string | null} name                        owner's display name
 * @property {string | null} title                       owner's title within the organization
 * @property {string | null} organization                organization name
 */

/**
 * @typedef {Object} TisContact
 * @property {string} type                               "email" / "phone" / "fax" / "url" / "address"
 * @property {string} value                              raw value (already trimmed; not URL-normalized)
 */

/**
 * @typedef {Object} TisCategory
 * @property {string} type                               "main" / "sub" / "other"
 * @property {string} value
 */

/**
 * @typedef {Object} TisDnsRecord
 * @property {string} type                               "A" / "AAAA" / "CNAME" / "TXT" / "MX" / "URL" / …
 * @property {string} host
 * @property {string} value
 * @property {number | null} priority                    MX only
 */

/**
 * @typedef {Object} TokenInfo
 * @property {string} chainId
 * @property {string} tick                               ticker (uppercase canonical)
 * @property {string | null} name                        TIS document `name` field — the artwork / display title; distinct from the ticker
 * @property {string | null} description                 free-form description text (TIS body if present, else on-chain)
 * @property {string | null} creator                     issuer address
 * @property {string | null} totalSupply                 formatted decimal string ("1000.5")
 * @property {string | null} maxSupply                   formatted decimal string, null if unlimited
 * @property {boolean} locked                            true when description/supply/mint is locked
 * @property {Object} locks                              full lock map (per-field booleans)
 * @property {number | null} marketPrice                 coin-denominated price, null if unset
 * @property {number | null} marketFloor                 coin-denominated floor, null if unset
 * @property {number | null} divisibility                token decimals (0-8); null when the explorer doesn't expose this field
 * @property {string[]} projects                         project ticks whose CURRENT roster includes this token (the "Official" banner data)
 * @property {string | null} imageUrl                    best-effort hero image URL (TIS images[0] if present, else regex from description)
 * @property {TisMediaEntry[]} images                    full image gallery (icon / standard / large / hires)
 * @property {TisMediaEntry[]} audio                     audio tracks
 * @property {TisMediaEntry[]} video                     video tracks
 * @property {string | null} website                     primary website URL (kept as singular for code that only needs the first)
 * @property {string[]} websites                         all website URLs published with the token (primary + alternates), in declaration order
 * @property {TisSocialEntry[]} socials                  social links (twitter / github / reddit / …)
 * @property {TisFileEntry[]} files                      arbitrary file attachments
 * @property {string | null} category                    primary (`main`-type) category — kept for backwards compatibility with the smoke pin
 * @property {TisCategory[]} categories                  full category list (main + sub + other)
 * @property {TisOwner | null} owner                     TIS owner identity (display name / title / organization). Distinct from `creator`, which is the on-chain issuer address.
 * @property {TisContact[]} contacts                     contact info: email / phone / fax / URL / postal address rows
 * @property {string | null} pgpsig                      PGP signature block published by the issuer for the metadata document
 * @property {TisDnsRecord[]} dns                        DNS records published with the metadata (A / CNAME / TXT / MX / …)
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
    for (const k of ['token', 'name', 'website', 'pgpsig']) {
        if (o[k]) out[k] = o[k];
    }
    // Some legacy / community JSONs embed raw HTML (iframes, scripts,
    // `<img>` tags) inside the free-form `description`. React would
    // render that as literal text, which is safe but ugly. Strip every
    // tag + any HTML entities so the description renders as plain prose,
    // matching xchain-explorer's `legacyJsonToXChainTIS`.
    if (typeof o.description === 'string' && o.description.trim()) {
        out.description = sanitizeDescription(o.description);
    }
    // Owner can be nested (`{ name, title, organization }`), a flat string
    // (`"Kane Mayfield"`), or a sibling field (`owner_name`). Normalize all
    // three shapes onto the same nested object.
    if (o.owner && typeof o.owner === 'object') {
        out.owner = { ...o.owner };
    } else if (typeof o.owner === 'string' && o.owner.trim()) {
        out.owner = { name: o.owner.trim() };
    } else {
        out.owner = {};
    }
    if (!out.owner.name && typeof o.owner_name === 'string') out.owner.name = o.owner_name;
    if (!out.owner.title && typeof o.owner_title === 'string') out.owner.title = o.owner_title;
    if (!out.owner.organization && typeof o.owner_organization === 'string') out.owner.organization = o.owner_organization;
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
    // Legacy CoinDaddy documents commonly publish `website_alternate1`
    // and `website_alternate2` for additional URLs. Lift them onto a
    // wallet-side `websites` array so the renderer can iterate as
    // "Website 1 / 2 / 3" without having to special-case the legacy
    // sibling fields.
    const websites = [];
    if (typeof o.website === 'string' && o.website.trim()) websites.push(o.website.trim());
    if (typeof o.website_alternate1 === 'string' && o.website_alternate1.trim()) {
        websites.push(o.website_alternate1.trim());
    }
    if (typeof o.website_alternate2 === 'string' && o.website_alternate2.trim()) {
        websites.push(o.website_alternate2.trim());
    }
    if (Array.isArray(o.websites)) {
        for (const w of o.websites) {
            if (typeof w === 'string' && w.trim()) websites.push(w.trim());
        }
    }
    out.websites = websites;
    if (o.category) out.categories.push({ type: 'main', data: o.category });
    if (o.subcategory) out.categories.push({ type: 'sub', data: o.subcategory });
    return out;
}

// Plain-text scrub for token descriptions. Token issuers occasionally
// embed HTML markup (iframes, scripts, raw <img> tags) inside the
// `description` field; we never render that as HTML, but we also don't
// want the wallet's plain-text view to leak the raw tag soup into the
// UI. This drops every tag + decodes the four common HTML entities so
// the displayed prose reads cleanly. Mirrors the explorer's stripHtml
// step in legacyJsonToXChainTIS.
function sanitizeDescription(text) {
    if (typeof text !== 'string') return '';
    return text
        // Drop <script>…</script> blocks entirely (tag + body) so script
        // contents don't bleed into the description body.
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        // Strip every remaining tag, including <iframe …>.
        .replace(/<\/?[a-z][^>]*>/gi, '')
        // Decode the basic HTML entities a hand-written description tends
        // to contain.
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // Collapse the whitespace runs the tag removal often leaves behind.
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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
    // On-chain media reference — "action:<index>" of a FILE action,
    // preferred over `data` when both are present (TIS File Entry
    // Fields). Carried as `dataRef`; tokenInfoFor resolves it to the
    // configured explorer's raw FILE URL.
    const dataRef = (entry && typeof entry === 'object'
        && typeof entry.data_ref === 'string' && entry.data_ref)
        ? entry.data_ref : null;
    const url = dataRef ? null : normalizeMediaUrl(data);
    if (!url && !dataRef) return null;
    return {
        url,
        dataRef,
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
 *   name: string | null,
 *   description: string | null,
 *   images: TisMediaEntry[],
 *   audio: TisMediaEntry[],
 *   video: TisMediaEntry[],
 *   website: string | null,
 *   websites: string[],
 *   socials: TisSocialEntry[],
 *   files: TisFileEntry[],
 *   category: string | null,
 *   categories: TisCategory[],
 *   owner: TisOwner | null,
 *   contacts: TisContact[],
 *   pgpsig: string | null,
 *   dns: TisDnsRecord[]
 * }}
 */
export function tisToMediaBundle(doc) {
    const empty = {
        name: null,
        description: null,
        images: /** @type {TisMediaEntry[]} */ ([]),
        audio: /** @type {TisMediaEntry[]} */ ([]),
        video: /** @type {TisMediaEntry[]} */ ([]),
        website: null,
        websites: /** @type {string[]} */ ([]),
        socials: /** @type {TisSocialEntry[]} */ ([]),
        files: /** @type {TisFileEntry[]} */ ([]),
        packs: /** @type {Record<string, { name: string|null, description: string|null }>} */ ({}),
        category: null,
        categories: /** @type {TisCategory[]} */ ([]),
        owner: /** @type {TisOwner | null} */ (null),
        contacts: /** @type {TisContact[]} */ ([]),
        pgpsig: null,
        dns: /** @type {TisDnsRecord[]} */ ([]),
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
            // String shorthand → plaintext URL file.
            if (typeof f === 'string') {
                const url = normalizeMediaUrl(f);
                if (!url) return null;
                return { url, name: null, type: null, dataRef: null, locked: false, packId: null };
            }
            // Object form supports: { data: <url>, data_ref: 'action:<index>',
            // name, type, locked, pack_id }. data_ref takes precedence over data
            // when both are present (on-chain reference wins over off-chain URL).
            const dataRef = typeof f.data_ref === 'string' && f.data_ref ? f.data_ref : null;
            const url = dataRef ? null : normalizeMediaUrl(f.data);
            if (!dataRef && !url) return null;
            return {
                url,
                dataRef,
                name: (f.name) ? String(f.name) : null,
                type: (f.type) ? String(f.type) : null,
                locked: Boolean(f.locked),
                packId: (f.pack_id) ? String(f.pack_id) : null,
            };
        })
        .filter(Boolean);
    // Top-level `packs` map for display metadata of token-gated content packs.
    // See xchain-documentation/protocol/Token_Information_Standard.md.
    const packs = {};
    const packsRaw = doc.packs && typeof doc.packs === 'object' ? doc.packs : {};
    for (const id of Object.keys(packsRaw)) {
        const p = packsRaw[id];
        if (!p || typeof p !== 'object') continue;
        packs[String(id)] = {
            name: typeof p.name === 'string' ? p.name : null,
            description: typeof p.description === 'string' ? p.description : null,
        };
    }
    const socials = (Array.isArray(doc.social) ? doc.social : [])
        .map((s) => {
            if (!s || typeof s !== 'object') return null;
            const url = normalizeMediaUrl(s.data);
            if (!url) return null;
            return { platform: String(s.type || 'url'), url };
        })
        .filter(Boolean);
    const website = typeof doc.website === 'string' ? normalizeMediaUrl(doc.website) : null;
    // Build the de-duplicated websites array. legacyJsonToTis lifts
    // legacy `website_alternate1/2` and native TIS `websites: []`
    // entries onto `doc.websites`; here we normalize each URL and drop
    // duplicates (case-insensitive on the URL string).
    const websitesSeen = new Set();
    const websitesRaw = Array.isArray(doc.websites) ? doc.websites : [];
    const websites = [];
    for (const w of websitesRaw) {
        if (typeof w !== 'string') continue;
        const normalized = normalizeMediaUrl(w);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (websitesSeen.has(key)) continue;
        websitesSeen.add(key);
        websites.push(normalized);
    }
    const description = typeof doc.description === 'string' ? doc.description : null;
    const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : null;
    const pgpsig = typeof doc.pgpsig === 'string' && doc.pgpsig.trim() ? doc.pgpsig.trim() : null;
    const categoriesRaw = Array.isArray(doc.categories) ? doc.categories : [];
    const categories = categoriesRaw
        .map((c) => {
            if (!c || typeof c !== 'object' || typeof c.data !== 'string') return null;
            return { type: String(c.type || 'main'), value: c.data };
        })
        .filter(Boolean);
    const mainCategory = categories.find((c) => c.type === 'main');
    const category = mainCategory ? mainCategory.value : null;
    const ownerRaw = doc.owner;
    const owner = ownerRaw && typeof ownerRaw === 'object' && (ownerRaw.name || ownerRaw.title || ownerRaw.organization)
        ? {
            name: typeof ownerRaw.name === 'string' ? ownerRaw.name : null,
            title: typeof ownerRaw.title === 'string' ? ownerRaw.title : null,
            organization: typeof ownerRaw.organization === 'string' ? ownerRaw.organization : null,
        }
        : null;
    const contactsRaw = Array.isArray(doc.contacts) ? doc.contacts : [];
    const contacts = contactsRaw
        .map((c) => {
            if (!c || typeof c !== 'object' || typeof c.data !== 'string' || !c.data.trim()) return null;
            return { type: String(c.type || 'url'), value: c.data.trim() };
        })
        .filter(Boolean);
    const dnsRaw = Array.isArray(doc.dns) ? doc.dns : [];
    const dns = dnsRaw
        .map((r) => {
            if (!r || typeof r !== 'object') return null;
            const type = typeof r.type === 'string' ? r.type.toUpperCase() : '';
            if (!type) return null;
            const host = typeof r.host === 'string' ? r.host : '';
            const value = typeof r.value === 'string' ? r.value : '';
            if (!host && !value) return null;
            const priority = typeof r.priority === 'number' && Number.isFinite(r.priority)
                ? r.priority
                : null;
            return { type, host, value, priority };
        })
        .filter(Boolean);
    return {
        name,
        description,
        images,
        audio,
        video,
        website,
        websites,
        socials,
        files,
        packs,
        category,
        categories,
        owner,
        contacts,
        pgpsig,
        dns,
    };
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
    // Divisibility lives at the top of the indexer row (or, in legacy
    // exports, as `decimals`). Real xchain-explorer currently strips
    // this field — `bcformat` runs server-side so supply values come
    // back pre-formatted. We surface whatever's present so dev / future
    // explorer-exposure consumers can read a single field.
    const divisibilityRaw = row?.divisibility ?? row?.decimals ?? null;
    const divisibility = (divisibilityRaw != null && Number.isFinite(Number(divisibilityRaw)))
        ? Number(divisibilityRaw)
        : null;
    // Project registry memberships (explorer getToken `projects[]`) — each
    // entry names a project tick whose CURRENT roster includes this token.
    // Backs the "Official" banner; the registry's display policy is
    // "just show it" (Project_Registry.md), so no extra filtering here.
    const projects = Array.isArray(row?.projects)
        ? row.projects
            .map((p) => (p && typeof p.project === 'string' && p.project ? p.project.toUpperCase() : null))
            .filter((p) => p !== null)
        : [];
    // TIS bundle (when fetched) supplies the richer description body and
    // media arrays. We keep the on-chain description string as a fallback
    // for the description text, but prefer the TIS body when available
    // since it's usually the human-readable version. The hero `imageUrl`
    // falls back to the regex extractor for tokens that didn't bother
    // with a TIS document.
    const description = tisBundle?.description || onChainDescription;
    const name = tisBundle?.name || null;
    const images = tisBundle?.images || [];
    const audio = tisBundle?.audio || [];
    const video = tisBundle?.video || [];
    const website = tisBundle?.website || null;
    const websites = tisBundle?.websites || [];
    const socials = tisBundle?.socials || [];
    const files = tisBundle?.files || [];
    const packs = tisBundle?.packs || {};
    const category = tisBundle?.category || null;
    const categories = tisBundle?.categories || [];
    const owner = tisBundle?.owner || null;
    const contacts = tisBundle?.contacts || [];
    const pgpsig = tisBundle?.pgpsig || null;
    const dns = tisBundle?.dns || [];
    const imageUrl = (images.length > 0 && images[0]?.url)
        || extractImageUrl(onChainDescription);
    return {
        chainId,
        tick,
        name,
        description,
        creator,
        totalSupply,
        maxSupply,
        locked,
        locks: lockMap,
        marketPrice,
        marketFloor,
        divisibility,
        projects,
        imageUrl,
        images,
        audio,
        video,
        website,
        websites,
        socials,
        files,
        packs,
        category,
        categories,
        owner,
        contacts,
        pgpsig,
        dns,
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
        return parseTisText(text);
    } catch {
        return null;
    }
}

// On-chain TIS document pointer: DESCRIPTION = "action:<index>" (same
// chain) or "action:<COIN>:<index>" (sibling chain — base ticker, network
// tier implied by the token's network) naming a FILE action whose raw
// bytes are the TIS JSON (Token_Information_Standard.md — On-Chain
// Format). Same syntax as a file entry's `data_ref`, one level up.
// Match groups: [1] = optional base coin, [2] = action index.
export const TIS_ACTION_REF_RE = /^action:(?:(BTC|LTC|DOGE):)?([0-9]+)$/i;

/**
 * Fetch + parse an on-chain TIS document via the explorer's raw FILE
 * endpoint. Never raises — resolves null on any miss so the renderer
 * falls back to the plain description string.
 *
 * @param {object} args
 * @param {any} args.sdk                     per-chain SDK (explorer client configured)
 * @param {string | number} args.actionIndex FILE action index holding the TIS JSON
 * @param {string | null} [args.coin]        base coin ticker for a sibling-chain ref (null = same chain)
 * @returns {Promise<ReturnType<typeof tisToMediaBundle> | null>}
 */
export async function fetchOnChainTisBundle({ sdk, actionIndex, coin = null }) {
    if (typeof sdk?.getGatedFileRaw !== 'function') return null;
    try {
        // The raw endpoint serves non-gated FILE bytes too — for a JSON
        // document those bytes ARE the TIS text.
        const bytes = await sdk.getGatedFileRaw(String(actionIndex), coin);
        if (!bytes || !bytes.length) return null;
        const u8 = bytes instanceof Uint8Array
            ? bytes
            : new Uint8Array(/** @type {any} */ (bytes));
        const text = new TextDecoder().decode(u8);
        return parseTisText(text);
    } catch {
        return null;
    }
}

// Shared TIS text → media-bundle path for the off-chain (URL fetch) and
// on-chain (raw FILE bytes) document sources.
function parseTisText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { return null; }
    // The legacy adapter is idempotent for native TIS docs (already
    // has images[]/audio[]/video[]/social[]), so we run it
    // unconditionally to handle both shapes.
    const tis = legacyJsonToTis(parsed);
    return tisToMediaBundle(tis);
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
        return withDemoFallback(chainId, tick, null, null);
    }
    let raw = null;
    try {
        raw = await sdk.getToken(tick);
    } catch {
        raw = null;
    }
    // When the SDK returned nothing (typical of the demo wallet whose
    // stub SDK has no real indexer behind it), fall back to a synthetic
    // row from the demo set. The fallback row's description is treated
    // EXACTLY like a real on-chain description for the next step —
    // demos can therefore point at a real TIS JSON URL and the wallet
    // will fetch + parse it to exercise the live rendering path.
    const haveRealRow = raw && (Array.isArray(raw) ? raw.length > 0 : true);
    if (!haveRealRow) {
        raw = demoRowFor(tick);
    }
    let tisBundle = null;
    if (metadataFetchEnabled) {
        const row = Array.isArray(raw) ? raw[0] : raw;
        const description = row?.info?.description;
        const actionRef = typeof description === 'string'
            ? description.trim().match(TIS_ACTION_REF_RE)
            : null;
        const resolvedFetch = fetchImpl
            || (typeof fetch === 'function' ? fetch : null);
        if (actionRef) {
            // On-chain TIS document — resolve through the same explorer
            // the token row came from (no external fetch).
            tisBundle = await fetchOnChainTisBundle({ sdk, actionIndex: actionRef[2], coin: actionRef[1] || null });
        } else if (description && resolvedFetch) {
            tisBundle = await fetchTisBundle({
                description,
                fetch: resolvedFetch,
            });
        }
    }
    // When a demo entry ships a pre-built `tis` block (offline-friendly
    // bundle that doesn't need a network round-trip), use it as the
    // fallback if the live fetch came back empty.
    if (!tisBundle) {
        const demo = DEMO_TIS_BY_TICK[String(tick || '').toUpperCase()];
        if (demo?.tis) tisBundle = tisToMediaBundle(demo.tis);
    }
    resolveMediaDataRefs(tisBundle, sdk);
    return normalizeTokenInfo(chainId, tick, raw, tisBundle);
}

// Resolve on-chain media references (dataRef = "action:<index>") across a
// bundle's media arrays to the configured explorer's raw FILE URL so the
// renderers get a plain `src`. Entries stay dataRef-annotated either way.
export function resolveMediaDataRefs(bundle, sdk) {
    if (!bundle || typeof sdk?.fileRawUrl !== 'function') return bundle;
    for (const key of ['images', 'audio', 'video', 'files']) {
        const arr = bundle[key];
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
            if (!entry || entry.url || !(entry.dataRef)) continue;
            const m = String(entry.dataRef).match(TIS_ACTION_REF_RE);
            if (!m) continue;
            try { entry.url = sdk.fileRawUrl(m[2], m[1] || null); } catch { /* leave unresolved */ }
        }
    }
    return bundle;
}

// Build a synthetic indexer-row for a demo ticker so the rest of the
// pipeline (TIS fetch, normalize) treats it identically to a real
// indexer response. Returns null for unknown tickers.
function demoRowFor(tick) {
    const demo = DEMO_TIS_BY_TICK[String(tick || '').toUpperCase()];
    if (!demo) return null;
    return {
        info: { tick, description: demo.description, owner: demo.owner || null },
        supply: demo.supply || { current: null, max: null },
        locks: demo.locks || {},
        market: demo.market || { price: null, floor: null },
    };
}

// Hand-rolled demo TIS documents — keyed by ticker, mirror the TIS v1.0.0
// shape so they flow through `tisToMediaBundle` unchanged. URLs point at
// publicly hosted, freely-redistributable media so an offline demo can
// still showcase the gallery in a connected browser.
const DEMO_TIS_BY_TICK = {
    // PEPECREATURE — fully-populated TIS showcase. Exercises every field
    // in token-information-standard-v1.0.0-schema.json (name, owner,
    // contacts, categories, social, images of every type, audio, video,
    // files, dns, pgpsig) so the wallet's small popup can be visually
    // audited against a maxed-out token info document.
    PEPECREATURE: {
        description: 'Showcase entry: a fully-populated TIS document for visual QA.',
        owner: '1EbsYtUeLX2iFLwRLABUKLpNzKga',
        supply: { current: '170', max: '170' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
        market: { price: 0.012, floor: 0.008 },
        tis: {
            tick: 'PEPECREATURE',
            name: 'Pepe Creature',
            description: 'A fully-populated Token Information Standard document used to stress-test the wallet\'s token detail surface. Pepe Creature is a Fake Rare card minted with extensive metadata — owner identity, contact rows, social presence, layered imagery, audio + video media, attached files, DNS records, and a PGP signature for the whole envelope.',
            website: 'https://fakeraredirectory.com/fake-rares/',
            websites: [
                'https://fakeraredirectory.com/fake-rares/',
                'https://kanemayfield.example/',
                'https://pepe-creature.example/',
            ],
            pgpsig: '-----BEGIN PGP SIGNATURE-----\nVersion: GnuPG v2\n\niQEcBAEBCgAGBQJabcDEFGAAoJEHbpb1f0F0EXAMPLE/SIGNATURE/BLOCK/HERE\nVjW8a3pVjNqYxqq4u8z2/EXAMPLE/SIGNATURE/BLOCK/HERE+1KZ5GzkXxRz3o5\n7y0qD5xOq5+1KZ5GzkXxRz3o57y0qD5xOq5+EXAMPLE+SIGNATURE+BLOCK+abc/\nlzqzqp4VjW8a3pVjNqYxqq4u8z2EXAMPLE-SIGNATURE-BLOCK-1234567890abcd\n=AbCd\n-----END PGP SIGNATURE-----',
            owner: {
                name: 'Kane Mayfield',
                title: 'Artist',
                organization: 'Fake Rares Studio',
            },
            contacts: [
                { type: 'email', data: 'hello@fakeraredirectory.com' },
                { type: 'phone', data: '+1 (555) 010-0123' },
                { type: 'fax', data: '+1 (555) 010-0124' },
                { type: 'url', data: 'https://kanemayfield.example/contact' },
                { type: 'address', data: '123 Fake Rare Way, Suite 4, Brooklyn, NY 11201, USA' },
            ],
            categories: [
                { type: 'main', data: 'Art & Literature' },
                { type: 'sub', data: 'Digital Collectibles' },
                { type: 'other', data: 'Fake Rares' },
            ],
            social: [
                { type: 'twitter', data: 'https://twitter.com/KaneMayfield' },
                { type: 'github', data: 'https://github.com/fakerares' },
                { type: 'reddit', data: 'https://www.reddit.com/r/rarepepe/' },
                { type: 'facebook', data: 'https://facebook.com/fakerares' },
                { type: 'linkedin', data: 'https://linkedin.com/in/kanemayfield' },
                { type: 'discord', data: 'https://discord.gg/fakerares' },
                { type: 'telegram', data: 'https://t.me/fakerares' },
                { type: 'youtube', data: 'https://youtube.com/@fakerares' },
                { type: 'instagram', data: 'https://instagram.com/fakerares' },
            ],
            images: [
                { type: 'icon', data: 'https://gousue3rn3uppml5r5hloc4wqmojl2cqxyhvhnceairxkccnw7vq.ar.io/M6kqE3Fu6PexfY9OtwuWgxyV6FC-D1O0RAIjdQhNt-s/pepecreature_thumb.png', name: 'Pepe Creature Icon' },
                { type: 'standard', data: 'https://gousue3rn3uppml5r5hloc4wqmojl2cqxyhvhnceairxkccnw7vq.ar.io/M6kqE3Fu6PexfY9OtwuWgxyV6FC-D1O0RAIjdQhNt-s/pepecreature_thumb.png', name: 'Pepe Creature' },
                { type: 'large', data: 'https://gousue3rn3uppml5r5hloc4wqmojl2cqxyhvhnceairxkccnw7vq.ar.io/jDEXyFCLp7mv3IozMQ2WL_L-vgoYYWg6_EpKD_62pw4/pepecreature_full.jpg', name: 'Pepe Creature (full)' },
                { type: 'hires', data: 'https://gousue3rn3uppml5r5hloc4wqmojl2cqxyhvhnceairxkccnw7vq.ar.io/jDEXyFCLp7mv3IozMQ2WL_L-vgoYYWg6_EpKD_62pw4/pepecreature_full.jpg', name: 'Pepe Creature (hi-res)' },
            ],
            audio: [
                { type: 'mp3', data: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', name: 'Theme song' },
            ],
            video: [
                // Canonical PEPECREATURE video lives at
                //   https://2ouj…ar.io/06idTprqf…?/16tonspepe.mp4
                // but that ar.io gateway returns HTTP 402 (paywalled) and
                // the file isn't replicated to free Arweave gateways. We
                // substitute a publicly-hosted MP4 so the wallet's video
                // player actually renders — purely a demo stub.
                { type: 'mp4', data: 'https://www.w3schools.com/html/mov_bbb.mp4', name: '16 Tons Pepe (demo substitute)' },
            ],
            files: [
                { type: 'pdf', data: 'https://example.com/pepecreature-whitepaper.pdf', name: 'Pepe Creature Whitepaper' },
                { type: 'doc', data: 'https://example.com/pepecreature-lore.docx', name: 'Lore document' },
                { type: 'xls', data: 'https://example.com/pepecreature-traits.xlsx', name: 'Trait spreadsheet' },
            ],
            dns: [
                { type: 'A', host: 'pepecreature.example', value: '192.0.2.42' },
                { type: 'AAAA', host: 'pepecreature.example', value: '2001:db8::42' },
                { type: 'CNAME', host: 'www.pepecreature.example', value: 'pepecreature.example' },
                { type: 'TXT', host: 'pepecreature.example', value: 'v=spf1 include:_spf.example.com ~all' },
                { type: 'MX', host: 'pepecreature.example', value: 'mail.pepecreature.example', priority: 10 },
            ],
        },
    },
    RAREPEPE: {
        description: 'A classic Rare Pepe card from the Counterparty era — one of the original on-chain NFTs.',
        owner: '1RarePepe2WalletDemoBitcoinAddressXyz',
        supply: { current: '300', max: '300' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
        tis: {
            description: 'A classic Rare Pepe card from the Counterparty era — one of the original on-chain NFTs.',
            images: [
                { type: 'icon', data: 'https://rarepepedirectory.com/pepe/PEPECASH.png' },
                { type: 'standard', data: 'https://rarepepedirectory.com/pepe/NAKAMOTOCARD.png' },
            ],
            website: 'https://rarepepedirectory.com/',
            social: [
                { type: 'twitter', data: 'https://twitter.com/rarepepenft' },
                { type: 'reddit', data: 'https://www.reddit.com/r/rarepepe/' },
            ],
            files: [
                { name: 'Rare Pepe Whitepaper (demo)', data: 'https://rarepepedirectory.com/' },
            ],
            categories: [{ type: 'main', data: 'Collectibles' }],
        },
    },
    XCHAINLOGO: {
        description: 'Full-media showcase token. Pairs an image gallery with sample audio and video to exercise every TIS player on the token detail page.',
        owner: '1XChainDemoOwnerLitecoinAddressDemo',
        supply: { current: '1', max: '1' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
        tis: {
            description: 'Full-media showcase token. Pairs an image gallery with sample audio and video to exercise every TIS player on the token detail page.',
            images: [
                { type: 'icon', data: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/240px-Bitcoin.svg.png' },
                { type: 'standard', data: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Litecoin_Logo.png/240px-Litecoin_Logo.png' },
                { type: 'standard', data: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Dogecoin_Logo.png/240px-Dogecoin_Logo.png' },
            ],
            audio: [
                { type: 'mp3', name: 'SoundHelix demo track', data: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
            ],
            video: [
                { type: 'mp4', name: 'Big Buck Bunny (sample)', data: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
            ],
            website: 'https://xchain.io',
            social: [
                { type: 'twitter', data: 'https://twitter.com/' },
                { type: 'github', data: 'https://github.com/XChain-platform' },
            ],
            categories: [{ type: 'main', data: 'Showcase' }],
        },
    },
    XCP: {
        description: 'Counterparty (XCP) — the original Bitcoin-based token protocol whose conventions XChain extends.',
        owner: null,
        supply: { current: '2649755.68', max: '2649755.68' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
        market: { price: 0.0001, floor: 0.00009 },
        tis: {
            description: 'Counterparty (XCP) — the original Bitcoin-based token protocol whose conventions XChain extends.',
            images: [
                { type: 'icon', data: 'https://counterparty.io/static/images/counterparty-logo.png' },
            ],
            website: 'https://counterparty.io',
            social: [
                { type: 'twitter', data: 'https://twitter.com/counterpartyxcp' },
                { type: 'github', data: 'https://github.com/CounterpartyXCP' },
            ],
            categories: [{ type: 'main', data: 'Protocol' }],
        },
    },
    PEPECASH: {
        description: 'PEPECASH — the currency of the Rare Pepe ecosystem.',
        owner: null,
        supply: { current: '700000000', max: '1000000000' },
        locks: { description: true, max_supply: true, mint: false, mint_supply: false },
        market: { price: 0.0000012, floor: 0.0000010 },
        tis: {
            description: 'PEPECASH — the currency of the Rare Pepe ecosystem.',
            images: [
                { type: 'icon', data: 'https://rarepepedirectory.com/pepe/PEPECASH.png' },
            ],
            website: 'https://rarepepedirectory.com/',
            social: [
                { type: 'twitter', data: 'https://twitter.com/rarepepenft' },
            ],
            categories: [{ type: 'main', data: 'Currency' }],
        },
    },
    DOGINAL: {
        description: 'A Doginal — Dogecoin-inscribed digital collectible.',
        owner: null,
        supply: { current: '1', max: '1' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
        tis: {
            description: 'A Doginal — Dogecoin-inscribed digital collectible.',
            images: [
                { type: 'icon', data: 'https://upload.wikimedia.org/wikipedia/en/d/d0/Dogecoin_Logo.png' },
            ],
            categories: [{ type: 'main', data: 'Collectibles' }],
            website: 'https://dogecoin.com',
        },
    },
};
