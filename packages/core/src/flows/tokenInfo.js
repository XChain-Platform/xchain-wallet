// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// assetInfo: read-only wrapper over `sdk.getToken`. Backs the §27.6
// token detail richer metadata (description, creator, supply, lock
// status, market price), the §27.5 collectibles image URL extraction,
// and the §27.6 Token Information Standard (TIS) gallery (images,
// audio, video, website, social links, files) when the token's
// description is a URL pointing at a TIS JSON document.
//
// xchain-explorer's `/api/token/{TICK}` returns a richly nested
// payload (info / supply / locks / market / mints / callback / lists)
// with the original column names. This wrapper normalizes it down to
// the stable surface the wallet's UI needs without leaking the inner
// shape across host boundaries; that way a future explorer schema
// addition (e.g. exposing `decimals` once xchain-explorer drops the
// strip) doesn't require renderer-side changes to consume.
//
// When the on-chain `description` is a URL (https / ipfs / ar / ord),
// the wallet fetches the JSON document and merges TIS v1.0.0 fields
// (or legacy CoinDaddy fields converted via `legacyJsonToTis`) onto
// the normalized TokenInfo. Raw `html` content from the TIS document
// is explicitly dropped; the wallet popup holds keys, so we don't
// render author-supplied HTML even sandboxed.

// Fully-populated reference TIS document for the demo EXAMPLE token.
// Kept as a standalone JSON file (not inlined) so it doubles as a
// readable, copy-pasteable sample of a maxed-out TIS v1.0.0 envelope.
import exampleTis from './demoExampleTis.json' with { type: 'json' };
import {
    ARWEAVE_GATEWAY_BASE,
    IPFS_GATEWAY_BASE,
} from '../branding/branding.js';
import { fetchWithRetry } from '../shared/utils/fetchWithRetry.js';
import { readRawFile } from './rawFileRead.js';
import { imagePreviewDataUrl } from '../shared/utils/publishingFile.js';

/**
 * @typedef {Object} TisMediaEntry
 * @property {string | null} url                         full https URL after scheme rewrite
 * @property {string | null} dataRef                     on-chain FILE action reference
 * @property {string | null} type                        extension or TIS-supplied type ("png" / "icon" / "mp4" / …)
 * @property {string | null} name                        human-readable label when the TIS document provides one
 * @property {boolean} locked                            whether the referenced FILE contains gated ciphertext
 * @property {string | null} packId                      TIS pack metadata key
 * @property {string | null} title                       display title supplied by the TIS document
 * @property {string | null} hash                        declared sha256 hash
 * @property {string | null} size                        declared dimensions or byte-size label
 */

/**
 * @typedef {Object} TisSocialEntry
 * @property {string} platform                           "facebook" / "github" / "twitter" / "reddit" / "linkedin" / "url" / …
 * @property {string} claimedPlatform                    platform name supplied by the token issuer
 * @property {string} host                               actual lower-case destination hostname
 * @property {string} url                                rendered as the link href
 */

/**
 * @typedef {Object} TisFileEntry
 * @property {string | null} url
 * @property {string | null} dataRef
 * @property {string | null} name
 * @property {string | null} type
 * @property {boolean} locked
 * @property {string | null} packId
 * @property {string | null} title
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
 * @property {string | null} name                        TIS document `name` field: the artwork / display title; distinct from the ticker
 * @property {string | null} description                 free-form description text (TIS body if present, else on-chain)
 * @property {string | null} creator                     issuer address
 * @property {string | null} totalSupply                 formatted decimal string ("1000.5")
 * @property {string | null} maxSupply                   formatted decimal string, null if unlimited
 * @property {boolean} locked                            true when description/supply/mint is locked
 * @property {Object} locks                              full lock map (per-field booleans). PC-01's Mint settings panel reads `locks.max_mint` (LOCK_MAX_MINT), `locks.mint` (LOCK_MINT), `locks.mint_supply` (LOCK_MINT_SUPPLY), and `locks.max_supply` (LOCK_MAX_SUPPLY) to disable individual ISSUE v2 fields.
 * @property {string | null} mintMax                     ISSUE v2 `MAX_MINT`: cap per MINT transaction, null when unset (explorer's `mints.max` collapses NULL and 0 to the same value, so 0 reads as unset here too)
 * @property {string | null} mintAddressMax               ISSUE v2 `MINT_ADDRESS_MAX`: cumulative cap per minting address, null when unset
 * @property {string | null} mintStartBlock               ISSUE v2 `MINT_START_BLOCK`: block height public minting opens, null when unset
 * @property {string | null} mintStopBlock                ISSUE v2 `MINT_STOP_BLOCK`: block height public minting closes, null when unset
 * @property {string | null} callbackTick                 ISSUE v4 `CALLBACK_TICK`: the tick holders are paid in when the owner force-recalls (CALLBACK), null when unset
 * @property {string | null} callbackAmount               ISSUE v4 `CALLBACK_AMOUNT`: units of CALLBACK_TICK paid per unit of this tick held, null when unset
 * @property {string | null} callbackBlock                ISSUE v4 `CALLBACK_BLOCK`: earliest block CALLBACK may fire, null when unset (PC-03)
 * @property {string | null} allowList                    ISSUE v5 `ALLOW_LIST`: LIST action index of the address allow-list gating this tick, null when unset (PC-04)
 * @property {string | null} blockList                    ISSUE v5 `BLOCK_LIST`: LIST action index of the address block-list gating this tick, null when unset (PC-04)
 * @property {string | null} bridgeChains                 ISSUE v7 `BRIDGE_CHAINS`: the issuer's opt-in destination list, still in its wire form (a comma list, or the '-' sentinel for "no destinations", which a reported null also becomes); null when the field is absent, which means UNKNOWN and not "none"
 * @property {string | null} minDepth                     ISSUE v7 `MIN_DEPTH`: issuer-raised confirmation depth before a lock is bridged, null when unset (the coin's own resolveConfirmations then stands alone)
 * @property {boolean | null} lockBridge                  ISSUE v7 `LOCK_BRIDGE`: BRIDGE_CHAINS and MIN_DEPTH frozen forever; null when the field is absent (unknown), never guessed false
 * @property {boolean | null} bridged                     set by the first applied XBRIDGE lock and never cleared: a copy of this token exists on another chain; null when the field is absent (unknown)
 * @property {number | null} marketPrice                 coin-denominated price, null if unset
 * @property {number | null} marketFloor                 coin-denominated floor, null if unset
 * @property {number | null} divisibility                token decimals (0-8); null when the explorer doesn't expose this field
 * @property {boolean} [loadError]                     true when the explorer failed to answer; every field then reads as unknown
 * @property {Array<{project:string, linkActionIndex:string|null, rosterActionIndex:string|null}>} projects project rosters whose CURRENT membership includes this token
 * @property {{rosterActionIndex:string|null, membershipActionIndex:string|null, linkActionIndex:string|null, total:number}|null} registry this token's project roster, when it owns one
 * @property {Array<Object>} linkedFiles                 owner-attached FILE+LINK rows read in one bulk request
 * @property {string | null} imageUrl                    best-effort hero image URL (TIS images[0] if present, else regex from description)
 * @property {TisMediaEntry[]} images                    full image gallery (icon / standard / large / hires)
 * @property {TisMediaEntry[]} audio                     audio tracks
 * @property {TisMediaEntry[]} video                     video tracks
 * @property {string | null} website                     primary website URL (kept as singular for code that only needs the first)
 * @property {string[]} websites                         all website URLs published with the token (primary + alternates), in declaration order
 * @property {TisSocialEntry[]} socials                  social links (twitter / github / reddit / …)
 * @property {TisFileEntry[]} files                      arbitrary file attachments
 * @property {string | null} category                    primary (`main`-type) category; kept for backwards compatibility with the smoke pin
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
    const md = extractMarkdownImageUrl(trimmed);
    if (md) return normalizeMediaUrl(md);
    const bare = extractBareImageUrl(trimmed);
    if (bare) return normalizeMediaUrl(bare);
    const ipfs = /\b(ipfs:\/\/[A-Za-z0-9]+(?:\/[\S]+)?)/i.exec(trimmed);
    if (ipfs && ipfs[1]) return normalizeMediaUrl(ipfs[1]);
    return null;
}

// --- js/polynomial-redos replacements ------------------------------------
//
// extractMarkdownImageUrl() replaces /!\[[^\]]*\]\((https?:\/\/[^)\s]+|ipfs:\/\/[^)\s]+)\)/i
// extractBareImageUrl() replaces      /\b(https?:\/\/\S+?\.(?:png|jpe?g|gif|svg|webp|avif))(?:[?#]\S*)?\b/i
//
// Both original regexes were unanchored (.exec searches every start
// position) and paired with a quantifier whose failure is only
// discovered after scanning far ahead ("![" with no later "]", or
// "http://" with no valid extension before the next whitespace). A
// description built out of many repeats of the trigger text (e.g.
// "![![![...") makes each of the O(n) start positions redo an O(n)
// scan, which is the O(n^2) CodeQL flags.
//
// These replacements find the SAME leftmost match by hand, but every
// "find the next X" step uses indexOf() results that only ever move
// forward through the string, so no span of text is scanned twice and
// total work stays O(n). Matching output was verified byte-for-byte
// against the original regexes across ~60k random and structured
// inputs (including the exact "many repeats of the trigger" shapes)
// during development; see the differential check referenced in the
// component report.

function isWordChar(ch) {
    return ch !== undefined && ch !== '' && /[A-Za-z0-9_]/.test(ch);
}

function isBoundaryAt(text, pos) {
    return isWordChar(text[pos - 1]) !== isWordChar(text[pos]);
}

function extractMarkdownImageUrl(text) {
    let searchFrom = 0;
    // The ']' search only ever moves forward (bangBracket increases each
    // retry), so caching the last indexOf(']', ...) result and reusing it
    // whenever the next query still falls inside the span already
    // searched turns O(n) *retries* of an O(n) scan into one O(n) scan.
    let closeCacheResult = text.indexOf(']', 0);
    function nextCloseBracket(from) {
        if (closeCacheResult === -1 || from <= closeCacheResult) return closeCacheResult;
        closeCacheResult = text.indexOf(']', from);
        return closeCacheResult;
    }
    while (true) {
        const bangBracket = text.indexOf('![', searchFrom);
        if (bangBracket === -1) return null;
        const altEnd = nextCloseBracket(bangBracket + 2);
        // No ']' anywhere further on: no "![" occurrence from here forward
        // can ever complete either, so there is nothing left to try.
        if (altEnd === -1) return null;
        if (text[altEnd + 1] !== '(') { searchFrom = bangBracket + 1; continue; }
        const urlStart = altEnd + 2;
        let prefixLen = 0;
        const schemeProbe = text.slice(urlStart, urlStart + 8).toLowerCase();
        if (schemeProbe.startsWith('https://')) prefixLen = 8;
        else if (schemeProbe.startsWith('http://')) prefixLen = 7;
        else if (schemeProbe.startsWith('ipfs://')) prefixLen = 7;
        else { searchFrom = bangBracket + 1; continue; }
        let bodyEnd = urlStart + prefixLen;
        while (bodyEnd < text.length && text[bodyEnd] !== ')' && !/\s/.test(text[bodyEnd])) bodyEnd++;
        if (bodyEnd === urlStart + prefixLen) { searchFrom = bangBracket + 1; continue; } // '+' needs >=1 char
        if (text[bodyEnd] !== ')') { searchFrom = bangBracket + 1; continue; }
        return text.slice(urlStart, bodyEnd);
    }
}

const BARE_IMAGE_EXTENSIONS = ['png', 'jpeg', 'jpg', 'gif', 'svg', 'webp', 'avif'];

// Precompute, once per whitespace-delimited run of text, every "." that is
// immediately followed by a recognised extension (left to right, so the
// list mirrors what the lazy `\S+?` would try in shortest-first order),
// plus a lookahead table of where a `\b` word boundary exists. Reused
// across every "http(s)://" occurrence that falls in the same run, so a
// run isn't rescanned once per occurrence.
function buildRunIndex(text, runStart, runEnd) {
    const lowerSlice = text.slice(runStart, runEnd).toLowerCase();
    const candidates = [];
    for (let i = 0; i < lowerSlice.length; i++) {
        if (lowerSlice[i] !== '.') continue;
        for (const ext of BARE_IMAGE_EXTENSIONS) {
            if (lowerSlice.startsWith(ext, i + 1)) { candidates.push({ pos: runStart + i, len: 1 + ext.length }); break; }
        }
    }
    const boundaryFrom = new Array(runEnd - runStart + 2).fill(false);
    for (let p = runEnd; p >= runStart; p--) {
        boundaryFrom[p - runStart] = isBoundaryAt(text, p) || boundaryFrom[p - runStart + 1];
    }
    return {
        candidates,
        boundaryFromInclusive(p) {
            if (p < runStart) return boundaryFrom[0];
            if (p > runEnd) return false;
            return boundaryFrom[p - runStart];
        },
    };
}

function lowerBoundPos(candidates, minPos) {
    let lo = 0, hi = candidates.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (candidates[mid].pos < minPos) lo = mid + 1; else hi = mid;
    }
    return lo;
}

function extractBareImageUrl(text) {
    const lower = text.toLowerCase();
    let httpsCache = lower.indexOf('https://', 0);
    let httpCache = lower.indexOf('http://', 0);
    function nextHttps(from) {
        if (httpsCache === -1 || from <= httpsCache) return httpsCache;
        return (httpsCache = lower.indexOf('https://', from));
    }
    function nextHttp(from) {
        if (httpCache === -1 || from <= httpCache) return httpCache;
        return (httpCache = lower.indexOf('http://', from));
    }

    let cachedRunStart = -1, cachedRunEnd = -1, cachedIndex = null;
    let searchFrom = 0;
    while (searchFrom <= text.length) {
        const a = nextHttps(searchFrom);
        const b = nextHttp(searchFrom);
        if (a === -1 && b === -1) return null;
        let schemeStart, bodyStart;
        if (a !== -1 && (b === -1 || a <= b)) { schemeStart = a; bodyStart = a + 8; }
        else { schemeStart = b; bodyStart = b + 7; }

        if (!isBoundaryAt(text, schemeStart)) { searchFrom = schemeStart + 1; continue; }

        let runEnd = bodyStart;
        while (runEnd < text.length && !/\s/.test(text[runEnd])) runEnd++;
        let runStart = bodyStart;
        while (runStart > 0 && !/\s/.test(text[runStart - 1])) runStart--;

        if (runStart !== cachedRunStart || runEnd !== cachedRunEnd) {
            cachedIndex = buildRunIndex(text, runStart, runEnd);
            cachedRunStart = runStart;
            cachedRunEnd = runEnd;
        }
        const { candidates, boundaryFromInclusive } = cachedIndex;
        let idx = lowerBoundPos(candidates, bodyStart + 1); // '+' needs >=1 body char before the dot
        let matched = null;
        while (idx < candidates.length) {
            const { pos, len } = candidates[idx];
            const extEnd = pos + len;
            const withoutQuery = isBoundaryAt(text, extEnd);
            const withQuery = (text[extEnd] === '?' || text[extEnd] === '#') && boundaryFromInclusive(extEnd + 1);
            if (withoutQuery || withQuery) { matched = text.slice(schemeStart, extEnd); break; }
            idx++;
        }
        if (matched) return matched;
        searchFrom = schemeStart + 1;
    }
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
        return `${IPFS_GATEWAY_BASE}/${t.slice('ipfs://'.length)}`;
    }
    if (/^ar:/i.test(t)) {
        return `${ARWEAVE_GATEWAY_BASE}/${t.replace(/^ar:/i, '')}`;
    }
    if (/^https?:\/\//i.test(t)) return t;
    return null;
}

const SOCIAL_SERVICE_HOSTS = {
    twitter: ['twitter.com', 'x.com'],
    x: ['x.com', 'twitter.com'],
    github: ['github.com'],
    reddit: ['reddit.com'],
    facebook: ['facebook.com'],
    linkedin: ['linkedin.com'],
    discord: ['discord.com', 'discord.gg'],
    telegram: ['t.me', 'telegram.me'],
    medium: ['medium.com'],
    youtube: ['youtube.com', 'youtu.be'],
    instagram: ['instagram.com'],
};

function normalizeSocialEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const value = typeof entry.data === 'string' ? entry.data : '';
    const claimedPlatform = String(entry.type || 'url').toLowerCase();
    const url = normalizeMediaUrl(entry.data);
    if (!url) return value ? {
        platform: claimedPlatform,
        claimedPlatform,
        host: '',
        url: null,
        value,
    } : null;
    let host;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
    const expectedHosts = SOCIAL_SERVICE_HOSTS[claimedPlatform] || [];
    const hostMatches = expectedHosts.some(
        (expected) => host === expected || host.endsWith(`.${expected}`),
    );
    return {
        platform: hostMatches ? claimedPlatform : 'url',
        claimedPlatform,
        host,
        url,
    };
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
    return tisDescriptionReference(description)?.url || null;
}

export const MAX_TIS_DOCUMENT_BYTES = 512 * 1024;
const TIS_HASH_RE = /^[a-f0-9]{64}$/i;
const ORDINALS_JSON_HOST = ['inscription-decoder', 'vercel', 'app'].join('.');
const ORDINALS_JSON_BASE = `https://${ORDINALS_JSON_HOST}/api/image?type=json&tx=`;

/**
 * Resolve a supported TIS description pointer without accepting active or
 * local schemes. The optional HTTPS suffix is a SHA-256 digest of the exact
 * response bytes, not a display title.
 *
 * @param {string | null | undefined} description
 * @returns {{ url: string, expectedHash: string | null } | null}
 */
export function tisDescriptionReference(description) {
    if (!description || typeof description !== 'string') return null;
    let t = description.trim();
    if (!t) return null;
    let expectedHash = null;
    const semi = t.lastIndexOf(';');
    if (semi > 0 && /^https:\/\//i.test(t)) {
        const suffix = t.slice(semi + 1).trim();
        if (TIS_HASH_RE.test(suffix)) expectedHash = suffix.toLowerCase();
        // Preserve the historical `;title` fetch form, but only a 64-hex
        // suffix is security material and therefore enforced.
        t = t.slice(0, semi).trim();
    }
    // Arweave gateway "/x.json" suffix trick: drop it; the gateway 404s.
    const arweavePrefix = `${ARWEAVE_GATEWAY_BASE}/`;
    if (t.toLowerCase().startsWith(arweavePrefix.toLowerCase())) {
        const suffix = t.slice(arweavePrefix.length);
        if (/^[^\/?#]+\/x\.json$/i.test(suffix)) {
            t = arweavePrefix + suffix.slice(0, -'/x.json'.length);
        }
    }
    if (/^ipfs:/i.test(t)) {
        const ref = t.replace(/^ipfs:(\/\/)?/i, '').trim();
        return ref ? { url: `${IPFS_GATEWAY_BASE}/${ref}`, expectedHash: null } : null;
    }
    if (/^ord:/i.test(t)) {
        let ref = t.replace(/^ord:/i, '').trim();
        if (!ref) return null;
        if (!TIS_HASH_RE.test(ref)) {
            try {
                const bytes = Uint8Array.from(atob(ref), (char) => char.charCodeAt(0));
                ref = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
            } catch {
                return null;
            }
        }
        return TIS_HASH_RE.test(ref)
            ? { url: `${ORDINALS_JSON_BASE}${ref.toLowerCase()}`, expectedHash: null, viaExplorer: true }
            : null;
    }
    if (/^ar:/i.test(t)) {
        const ref = t.replace(/^ar:/i, '').trim();
        return ref ? { url: `${ARWEAVE_GATEWAY_BASE}/${ref}`, expectedHash: null } : null;
    }
    if (t.toLowerCase().startsWith(arweavePrefix.toLowerCase())) {
        return { url: t, expectedHash };
    }
    if (/^https:\/\//i.test(t) && /\.json(?:[?#]|$)/i.test(t)) {
        return { url: t, expectedHash };
    }
    return null;
}

function explorerRelayUrl(sdk, target) {
    if (typeof sdk?.fileRawUrl !== 'function') return null;
    try {
        const relay = new URL(sdk.fileRawUrl('0'));
        if (relay.protocol !== 'https:') return null;
        const parts = relay.pathname.split('/').filter(Boolean);
        const apiAt = parts.indexOf('api');
        if (apiAt < 1) return null;
        relay.pathname = `/${parts.slice(0, apiAt).join('/')}/relay`;
        relay.search = '';
        relay.hash = '';
        relay.searchParams.set('url', target);
        return relay.href;
    } catch {
        return null;
    }
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
//
// Fixed three related CodeQL findings (js/bad-tag-filter,
// js/incomplete-multi-character-sanitization, js/double-escaping) in the
// same pass, because they were three symptoms of one design gap:
//   1. The <script>…</script> matcher required an exact `</script>`, so
//      a browser-tolerated close like `</script foo="bar">` (a real HTML
//      tokenizer accepts anything before the '>', not just whitespace)
//      slipped through.
//   2. Entities were decoded AFTER tags were stripped, so an
//      entity-encoded tag ("&lt;script&gt;") doesn't look like a tag to
//      the strippers and only becomes one once decoded afterward -
//      classic decode-after-strip bypass.
//   3. A single non-looping pass can also leave a tag that only becomes
//      whole once an earlier removal joins two halves together
//      ("<scr" + "ipt>" -> "<script>" once something else is cut out
//      from between them).
// The fix: decode entities BEFORE stripping tags (not after) so an
// encoded tag is visible to the strippers, and run the whole decode+strip
// pipeline in a loop until a pass makes no further change, so whatever
// the previous pass exposed or joined gets caught on the next one. The
// entity decode itself is ONE regex with an alternation, not a chain of
// five sequential `.replace()` calls: a chain decodes its OWN output
// (decoding '&amp;' to '&' and then, later in the same chain, decoding
// the '&lt;' that '&' just became part of) and so can silently collapse
// TWO layers of escaping in a single pass; one alternated regex only ever
// scans the untouched input, so a doubly-encoded entity ("&amp;lt;")
// resolves one layer per pass, same as every other entity, and needs a
// second pass (which the loop provides) to fully resolve - never both at
// once. The loop is bounded (decoding/stripping only ever shortens the
// string, and `i` caps it besides), so this stays O(n).
const DESCRIPTION_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function sanitizeDescription(text) {
    if (typeof text !== 'string') return '';
    let out = text;
    for (let i = 0; i < 20 && out.length > 0; i += 1) {
        const before = out;
        out = out
            // Decode the basic HTML entities a hand-written description
            // tends to contain, all in one non-chained pass.
            .replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => DESCRIPTION_ENTITIES[m])
            // Drop <script>…</script> blocks entirely (tag + body) so
            // script contents don't bleed into the description body.
            // `<\/script[^>]*>` (not `<\/script>`): a browser's HTML
            // tokenizer treats ANYTHING between the tag name and '>' as a
            // valid (if bogus) close - not just whitespace, e.g.
            // `</script foo="bar">` - so the matcher has to tolerate it too.
            .replace(/<script\b[^<]*(?:(?!<\/script[^>]*>)<[^<]*)*<\/script[^>]*>/gi, '')
            // Strip every remaining tag, including <iframe …>.
            .replace(/<\/?[a-z][^>]*>/gi, '');
        if (out === before) break;
    }
    return out
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

// Same grammar as an on-chain TIS document pointer. File entries tolerate
// surrounding whitespace, but only a conforming reference can override data.
export const TIS_ACTION_REF_RE = /^action:(?:(BTC|LTC|DOGE):)?([0-9]+)$/i;

export function parseTisActionRef(value) {
    if (typeof value !== 'string') return null;
    const ref = value.trim();
    const match = ref.match(TIS_ACTION_REF_RE);
    if (!match) return null;
    return { ref, coin: match[1] || null, index: match[2] };
}

function tisEntryToMedia(entry) {
    if (!entry) return null;
    const objectEntry = entry && typeof entry === 'object' ? entry : null;
    const data = typeof entry === 'string' ? entry : objectEntry?.data;
    // On-chain media reference: "action:<index>" of a FILE action,
    // preferred over `data` when both are present (TIS File Entry
    // Fields). Carried as `dataRef`; tokenInfoFor resolves unlocked entries
    // to the configured explorer's raw FILE URL.
    const dataRef = parseTisActionRef(objectEntry?.data_ref)?.ref ?? null;
    const normalizedUrl = dataRef ? null : normalizeMediaUrl(data);
    const source = typeof data === 'string' ? data : null;
    if (!normalizedUrl && !dataRef && !source) return null;
    const locked = Boolean(objectEntry?.locked);
    return {
        url: locked ? null : normalizedUrl,
        source,
        dataRef,
        type: objectEntry?.type ? String(objectEntry.type) : null,
        name: objectEntry?.name ? String(objectEntry.name) : null,
        locked,
        packId: objectEntry?.pack_id ? String(objectEntry.pack_id) : null,
        title: objectEntry?.title ? String(objectEntry.title) : null,
        hash: objectEntry?.hash ? String(objectEntry.hash) : null,
        size: objectEntry?.size ? String(objectEntry.size) : null,
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
        websiteText: null,
        websites: /** @type {string[]} */ ([]),
        socials: /** @type {TisSocialEntry[]} */ ([]),
        files: /** @type {TisFileEntry[]} */ ([]),
        packs: /** @type {Record<string, { name: string|null, description: string|null }>} */ ({}),
        category: null,
        categories: /** @type {TisCategory[]} */ ([]),
        owner: /** @type {TisOwner | null} */ (null),
        contacts: /** @type {TisContact[]} */ ([]),
        pgpsig: null,
        htmlAvailable: false,
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
                return { url, source: f, name: null, title: null, type: null, dataRef: null, hash: null, size: null, locked: false, packId: null };
            }
            // Object form supports: { data: <url>, data_ref: 'action:<index>',
            // name, type, locked, pack_id }. A valid data_ref takes precedence
            // over data (on-chain reference wins over off-chain URL).
            const dataRef = parseTisActionRef(f.data_ref)?.ref ?? null;
            const normalizedUrl = dataRef ? null : normalizeMediaUrl(f.data);
            const source = typeof f.data === 'string' ? f.data : null;
            if (!dataRef && !normalizedUrl && !source) return null;
            const locked = Boolean(f.locked);
            return {
                url: locked ? null : normalizedUrl,
                source,
                dataRef,
                name: (f.name) ? String(f.name) : null,
                title: (f.title) ? String(f.title) : null,
                type: (f.type) ? String(f.type) : null,
                hash: (f.hash) ? String(f.hash) : null,
                size: (f.size) ? String(f.size) : null,
                locked,
                packId: (f.pack_id) ? String(f.pack_id) : null,
            };
        })
        .filter(Boolean);
    // Top-level `packs` map for display metadata of token-gated content packs.
    // See xchain-documentation/protocol/token-information-standard.md#json-field-definitions.
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
        .map(normalizeSocialEntry)
        .filter(Boolean);
    const websiteText = typeof doc.website === 'string' ? doc.website : null;
    const website = websiteText ? normalizeMediaUrl(websiteText) : null;
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
    // TIS `html` is deliberately never returned. The renderer receives only
    // this presence bit and may offer the explorer's guarded presentation.
    const htmlAvailable = typeof doc.html === 'string' && doc.html.trim().length > 0;
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
        websiteText,
        websites,
        socials,
        files,
        packs,
        category,
        categories,
        owner,
        contacts,
        pgpsig,
        htmlAvailable,
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
        const entry = {
            url, type: cls.ext, name: null, dataRef: null,
            locked: false, packId: null, title: null,
        };
        if (cls.kind === 'image') out.images.push(entry);
        else if (cls.kind === 'audio') out.audio.push(entry);
        else if (cls.kind === 'video') out.video.push(entry);
    }
    return out;
}

/**
 * A token row's BRIDGE_CHAINS in its wire form, not pre-split: '-' means "no
 * destinations" and '' means "unchanged" on the wire, a distinction
 * bridgeChainsList() owns and an array would erase (String([]) === '' reads
 * as unknown).
 *
 * A key that is PRESENT with a null value is not absence: the indexer stores
 * NULL both for a token that never opted in and for the '-' opt-out, and
 * refuses a v3 lock on either, so that reported "no destinations" becomes
 * '-'. Only a source that omits the key (an explorer without the bridge
 * columns) leaves the field unknown, which is null.
 *
 * @param {any} row explorer row, grouped or flat
 * @returns {string | null}
 */
function readBridgeChains(row) {
    const raw = row?.info?.bridge_chains ?? row?.bridge_chains ?? null;
    if (raw != null && String(raw).trim() !== '') return String(raw).trim();
    const reportedNone = raw === null
        && (row?.info?.bridge_chains === null || row?.bridge_chains === null);
    return reportedNone ? '-' : null;
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
 * @param {{ allowRemoteMedia?: boolean, tisReadError?: boolean, fallbackImages?: Array<Object> }} [options]
 * @returns {TokenInfo}
 */
export function normalizeTokenInfo(chainId, tick, raw, tisBundle = null, options = {}) {
    const { allowRemoteMedia = true, tisReadError = false, fallbackImages = [] } = options;
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
    // PC-01 mint-configuration fields (ISSUE v2): xchain-explorer's
    // getToken groups these under a `mints` object (db.js getToken,
    // "Group MINT fields"). The grouping loop there runs every mint_*
    // column through `Number(value)`, and SQL NULL becomes `Number(null)
    // === 0`, so an explicitly-configured 0 and a never-configured field
    // are indistinguishable on the wire; treat both as "unset" (null)
    // rather than showing a misleading "0" in the Mint settings panel.
    // The explorer sends these as numbers or as decimal strings, and a string
    // "0" is truthy, so zero is tested by value: read as a cap, it made the
    // Mint form call every token without MAX_MINT "at its supply cap".
    const mintsRaw = row?.mints && typeof row.mints === 'object' ? row.mints : {};
    const unsetWhenZero = (value) => (
        value == null || String(value).trim() === '' || Number(value) === 0 ? null : String(value)
    );
    const mintMax = unsetWhenZero(mintsRaw.max);
    const mintAddressMax = unsetWhenZero(mintsRaw.address_max);
    const mintStartBlock = unsetWhenZero(mintsRaw.start_block);
    const mintStopBlock = unsetWhenZero(mintsRaw.stop_block);
    // PC-03 callback config (ISSUE v4): xchain-explorer's getToken groups
    // these under a `callback` object { tick, price, block, amount }. Unlike
    // the mint fields (which run every column through Number(), collapsing 0
    // and NULL), the explorer leaves callback tick/block/amount as raw values,
    // so we can distinguish "unset" (null/empty) from a real 0. `amount` is
    // already bcformat'd to the CALLBACK_TICK's decimals server-side.
    const callbackRaw = row?.callback && typeof row.callback === 'object' ? row.callback : {};
    const callbackTick = callbackRaw.tick ? String(callbackRaw.tick) : null;
    const callbackAmount = (callbackRaw.amount != null && String(callbackRaw.amount) !== '')
        ? String(callbackRaw.amount) : null;
    const callbackBlock = (callbackRaw.block != null && String(callbackRaw.block) !== '')
        ? String(callbackRaw.block) : null;
    // PC-04 access lists (ISSUE v5): xchain-explorer's getToken groups these
    // under `lists: { allow, block }` as LIST action indexes (numeric) or
    // null. A detached list may be reported as the protocol's 0 sentinel,
    // which is also no active policy list.
    const listsRaw = row?.lists && typeof row.lists === 'object' ? row.lists : {};
    const allowList = (listsRaw.allow != null && String(listsRaw.allow) !== '' && String(listsRaw.allow) !== '0')
        ? String(listsRaw.allow) : null;
    const blockList = (listsRaw.block != null && String(listsRaw.block) !== '' && String(listsRaw.block) !== '0')
        ? String(listsRaw.block) : null;
    // Bridge fields (ISSUE v7, xchain-token-bridge.md section 8 / the bridge
    // policy spec). Each is read from where the explorer's getToken grouping
    // loop actually puts it: every `lock_*` column is folded into `locks`, so
    // LOCK_BRIDGE arrives as `locks.bridge`, while `bridge_chains`, `min_depth`
    // and `bridged` match no group prefix and land in `info`. The flat column
    // name at the row root is accepted as a fallback for dev/demo rows that
    // never went through the explorer's grouping.
    //
    // Absence is UNKNOWN, and unknown stays null rather than collapsing to a
    // default: bridgeDestinationError makes no claim on a null bridgeChains but
    // refuses the move on an empty one, and a lockBridge guessed false would
    // offer an edit consensus has already frozen. Nothing here is defaulted.
    const bridgeChains = readBridgeChains(row);
    const minDepthRaw = row?.info?.min_depth ?? row?.min_depth ?? null;
    const minDepth = (minDepthRaw != null && String(minDepthRaw).trim() !== '')
        ? String(minDepthRaw).trim() : null;
    // TINYINT(1) on the wire. Read the explorer's own convention (=="1") so a
    // string "1", a number 1 and a driver-native true all answer true, and
    // anything else present answers false; only absence answers null.
    const lockBridgeRaw = lockMap.bridge ?? row?.info?.lock_bridge ?? row?.lock_bridge ?? null;
    const lockBridge = lockBridgeRaw == null ? null : truthyFlag(lockBridgeRaw);
    const bridgedRaw = row?.info?.bridged ?? row?.bridged ?? null;
    const bridged = bridgedRaw == null ? null : truthyFlag(bridgedRaw);
    const marketPrice = isFiniteNum(row?.market?.price) ? row.market.price : null;
    const marketFloor = isFiniteNum(row?.market?.floor) ? row.market.floor : null;
    // Divisibility lives at the top of the indexer row (or, in legacy
    // exports, as `decimals`). Real xchain-explorer currently strips
    // this field; `bcformat` runs server-side so supply values come
    // back pre-formatted. We surface whatever's present so dev / future
    // explorer-exposure consumers can read a single field.
    const divisibilityRaw = row?.divisibility ?? row?.decimals ?? row?.info?.decimals ?? null;
    const divisibility = (divisibilityRaw != null && Number.isFinite(Number(divisibilityRaw)))
        ? Number(divisibilityRaw)
        : null;
    // Project registry memberships (explorer getToken `projects[]`): each
    // entry names a project tick whose CURRENT roster includes this token.
    // Backs the "Official" banner; the registry's display policy is
    // "just show it" (Project_Registry.md), so no extra filtering here.
    const projects = Array.isArray(row?.projects)
        ? row.projects
            .map((p) => (p && typeof p.project === 'string' && p.project ? {
                project: p.project.toUpperCase(),
                linkActionIndex: p.link_action_index == null ? null : String(p.link_action_index),
                rosterActionIndex: p.roster_action_index == null ? null : String(p.roster_action_index),
            } : null))
            .filter((p) => p !== null)
        : [];
    const registryRaw = row?.registry && typeof row.registry === 'object' ? row.registry : null;
    const registry = registryRaw ? {
        rosterActionIndex: registryRaw.roster_action_index == null ? null : String(registryRaw.roster_action_index),
        membershipActionIndex: registryRaw.membership_action_index == null ? null : String(registryRaw.membership_action_index),
        linkActionIndex: registryRaw.link_action_index == null ? null : String(registryRaw.link_action_index),
        total: Number.isFinite(Number(registryRaw.total)) ? Number(registryRaw.total) : 0,
    } : null;
    const linkedFiles = Array.isArray(row?.linked_files)
        ? row.linked_files.flatMap((file) => {
            if (!file || file.action_index == null) return [];
            return [{
                actionIndex: String(file.action_index),
                name: file.name == null ? null : String(file.name),
                title: file.title == null ? null : String(file.title),
                type: file.type == null ? null : String(file.type),
                blockIndex: file.block_index == null ? null : String(file.block_index),
                gated: file.gated === true || Number(file.gated) === 1,
                gateTicker: file.gate_ticker == null ? null : String(file.gate_ticker),
                gateMinAmount: file.gate_min_amount == null ? null : String(file.gate_min_amount),
                keyHash: file.key_hash == null ? null : String(file.key_hash),
                encryptionMethod: file.encryption_method == null ? null : Number(file.encryption_method),
                url: typeof file.url === 'string' ? file.url : null,
            }];
        })
        : [];
    // TIS bundle (when fetched) supplies the richer description body and
    // media arrays. We keep the on-chain description string as a fallback
    // for the description text, but prefer the TIS body when available
    // since it's usually the human-readable version. The hero `imageUrl`
    // takes TIS images first, then vetted LINKed artwork, then the regex
    // extractor for tokens that did not publish either kind of picture.
    const description = tisBundle?.description || (tisReadError ? null : onChainDescription);
    const name = tisBundle?.name || null;
    const images = allowRemoteMedia ? [...(tisBundle?.images || []), ...fallbackImages] : [];
    const audio = allowRemoteMedia ? (tisBundle?.audio || []) : [];
    const video = allowRemoteMedia ? (tisBundle?.video || []) : [];
    const website = tisBundle?.website || null;
    const websiteText = tisBundle?.websiteText || null;
    const websites = tisBundle?.websites || [];
    const socials = tisBundle?.socials || [];
    const files = tisBundle?.files || [];
    const packs = tisBundle?.packs || {};
    const category = tisBundle?.category || null;
    const categories = tisBundle?.categories || [];
    const owner = tisBundle?.owner || null;
    const contacts = tisBundle?.contacts || [];
    const pgpsig = tisBundle?.pgpsig || null;
    const htmlAvailable = tisBundle?.htmlAvailable === true;
    const tisAvailable = tisBundle != null;
    const dns = tisBundle?.dns || [];
    const imageUrl = allowRemoteMedia
        ? (images.find((image) => !image?.locked && image?.url)?.url || extractImageUrl(onChainDescription))
        : null;
    return {
        chainId,
        tick,
        // The explorer's resolved canonical name for this token. Differs from
        // `tick` only when the lookup key was a `^<id>` reference: then `tick`
        // echoes `^<id>` while `canonicalTick` is the readable name. Used to
        // show names (not `^1234`) on the dApp approval screen.
        canonicalTick: row?.info?.tick ?? null,
        name,
        description,
        creator,
        totalSupply,
        maxSupply,
        locked,
        locks: lockMap,
        mintMax,
        mintAddressMax,
        mintStartBlock,
        mintStopBlock,
        callbackTick,
        callbackAmount,
        callbackBlock,
        allowList,
        blockList,
        bridgeChains,
        minDepth,
        lockBridge,
        bridged,
        marketPrice,
        marketFloor,
        divisibility,
        projects,
        registry,
        linkedFiles,
        imageUrl,
        images,
        audio,
        video,
        website,
        websiteText,
        websites,
        socials,
        files,
        packs,
        category,
        categories,
        owner,
        contacts,
        pgpsig,
        htmlAvailable,
        tisAvailable,
        tisReadError,
        dns,
    };
}

function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

// A TINYINT(1) flag as it can arrive over the wire: MariaDB's driver gives a
// number, the explorer's JSON gives a string, a hand-built dev row gives a
// boolean. Only `true` / 1 / "1" is set; every other present value is false.
function truthyFlag(v) {
    return v === true || v === 1 || String(v).trim() === '1';
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(record, key, maxLength) {
    return record[key] === undefined
        || (typeof record[key] === 'string' && record[key].length <= maxLength);
}

function uniqueJsonItems(items) {
    const seen = new Set();
    for (const item of items) {
        let key;
        try { key = JSON.stringify(item); } catch { return false; }
        if (seen.has(key)) return false;
        seen.add(key);
    }
    return true;
}

function validArray(record, key, validateItem, unique = false) {
    if (record[key] === undefined) return true;
    return Array.isArray(record[key])
        && (!unique || uniqueJsonItems(record[key]))
        && record[key].every(validateItem);
}

function validMediaEntry(kind, entry, requireData, validateGating) {
    if (!isRecord(entry)) return false;
    const enums = {
        images: ['icon', 'standard', 'large', 'hires'],
        audio: ['m4a', 'mp3', 'wav'],
        video: ['mp4', 'mov', 'wmv'],
    };
    if (entry.type === undefined) return false;
    if (enums[kind] && !enums[kind].includes(entry.type)) return false;
    if (!optionalString(entry, 'data', 255)
        || !optionalString(entry, 'name', 255)
        || !optionalString(entry, 'hash', 64)) return false;
    if (requireData) {
        if (typeof entry.data !== 'string') return false;
    } else if (typeof entry.data !== 'string' && typeof entry.data_ref !== 'string') {
        return false;
    }
    if (!validateGating) return true;
    return optionalString(entry, 'title', 255)
        && optionalString(entry, 'data_ref', 255)
        && (entry.locked === undefined || typeof entry.locked === 'boolean')
        && optionalString(entry, 'pack_id', 255);
}

function validTisCore(doc) {
    if (!isRecord(doc)
        || typeof doc.tick !== 'string'
        || typeof doc.name !== 'string'
        || doc.name.length > 127
        || !optionalString(doc, 'description', 2048)
        || !optionalString(doc, 'html', 10_000)
        || !optionalString(doc, 'website', 255)) return false;
    if (doc.website !== undefined && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(doc.website)) return false;
    if (doc.owner !== undefined) {
        if (!isRecord(doc.owner)
            || !optionalString(doc.owner, 'name', 128)
            || !optionalString(doc.owner, 'title', 128)
            || !optionalString(doc.owner, 'organization', 128)) return false;
    }
    if (!validArray(doc, 'contacts', (entry) => isRecord(entry)
        && ['address', 'email', 'phone', 'fax', 'url'].includes(entry.type)
        && typeof entry.data === 'string' && entry.data.length <= 255, true)) return false;
    if (!validArray(doc, 'categories', (entry) => isRecord(entry)
        && ['main', 'sub', 'other'].includes(entry.type)
        && typeof entry.data === 'string' && entry.data.length <= 255, true)) return false;
    if (!validArray(doc, 'social', (entry) => isRecord(entry)
        && typeof entry.type === 'string'
        && typeof entry.data === 'string' && entry.data.length <= 255)) return false;
    if (!validArray(doc, 'dns', (entry) => isRecord(entry)
        && ['A', 'AAAA', 'ALIAS', 'CAA', 'CNAME', 'NS', 'SRV', 'TXT', 'URL', 'MX', ''].includes(entry.type)
        && typeof entry.host === 'string' && entry.host.length <= 255
        && typeof entry.value === 'string' && entry.value.length <= 255
        && (entry.priority === undefined || Number.isInteger(entry.priority))
        && (entry.type !== 'MX' || Number.isInteger(entry.priority)), true)) return false;
    if (doc.packs !== undefined) {
        if (!isRecord(doc.packs)) return false;
        for (const pack of Object.values(doc.packs)) {
            if (!isRecord(pack)
                || !optionalString(pack, 'name', 255)
                || !optionalString(pack, 'description', 2048)) return false;
        }
    }
    return true;
}

/**
 * Schema-equivalent validation for the published v1.0.0 through v1.1.2
 * contracts. v1.0.0 requires `data` and leaves later gating keys open;
 * v1.1.1 and v1.1.2 accept `data_ref` and type those keys. v1.1.2's
 * corrected DNS requirements are enforced for every version.
 */
export function validateTisDocument(doc) {
    if (!validTisCore(doc)) return false;
    const kinds = ['images', 'audio', 'video', 'files'];
    const validatesAs = (requireData, validateGating) => kinds.every((kind) => (
        validArray(doc, kind, (entry) => validMediaEntry(kind, entry, requireData, validateGating), true)
    ));
    return validatesAs(false, true) || validatesAs(true, false);
}

async function responseTextWithinLimit(response) {
    const announced = Number(response?.headers?.get?.('content-length'));
    if (Number.isFinite(announced) && announced > MAX_TIS_DOCUMENT_BYTES) return null;
    if (typeof response?.body?.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
            length += chunk.length;
            if (length > MAX_TIS_DOCUMENT_BYTES) {
                await reader.cancel();
                return null;
            }
            chunks.push(chunk);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        return { text: new TextDecoder().decode(bytes), bytes };
    }
    if (typeof response?.arrayBuffer === 'function') {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > MAX_TIS_DOCUMENT_BYTES) return null;
        return { text: new TextDecoder().decode(bytes), bytes };
    }
    const text = await response.text();
    const bytes = new TextEncoder().encode(text);
    return bytes.length <= MAX_TIS_DOCUMENT_BYTES ? { text, bytes } : null;
}

async function sha256Hex(bytes) {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch a token's TIS document (or legacy CoinDaddy JSON) and convert it
 * into the wallet's media bundle. Returns null when the description
 * isn't a URL, the fetch fails, the response isn't JSON, or the document
 * is empty. Never raises; the renderer falls back to the on-chain
 * description string when this returns null.
 *
 * @param {object} args
 * @param {string} args.description                      on-chain description string
 * @param {typeof fetch} args.fetch                      injected for testability
 * @param {AbortSignal} [args.signal]                    cancels in-flight fetch
 * @param {any} [args.sdk]                              configured explorer client
 * @returns {Promise<ReturnType<typeof tisToMediaBundle> | null>}
 */
export async function fetchTisBundle({ description, fetch: fetchImpl, signal, sdk }) {
    const reference = tisDescriptionReference(description);
    if (!reference || typeof fetchImpl !== 'function') return null;
    try {
        const fetchUrl = reference.viaExplorer
            ? explorerRelayUrl(sdk, reference.url)
            : reference.url;
        if (!fetchUrl) return null;
        const resp = await fetchWithRetry(fetchImpl, fetchUrl, { signal, redirect: 'follow' });
        if (!resp || !resp.ok) return null;
        if (resp.url && !/^https:\/\//i.test(resp.url)) return null;
        const body = await responseTextWithinLimit(resp);
        if (!body) return null;
        if (reference.expectedHash && await sha256Hex(body.bytes) !== reference.expectedHash) return null;
        return parseTisText(body.text);
    } catch {
        return null;
    }
}

/**
 * Fetch + parse an on-chain TIS document via the explorer's raw FILE
 * endpoint. A FILE holding a bare image instead of JSON yields a bundle
 * whose only content is that picture. Never raises; resolves null on any
 * miss so the renderer falls back to the plain description string.
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
        // The raw endpoint serves non-gated FILE bytes too; for a JSON
        // document those bytes ARE the TIS text.
        const result = await readRawFile(sdk, String(actionIndex), coin);
        if (result.state !== 'ready') return null;
        const { bytes } = result;
        const u8 = bytes instanceof Uint8Array
            ? bytes
            : new Uint8Array(/** @type {any} */ (bytes));
        const parsed = u8.length <= MAX_TIS_DOCUMENT_BYTES
            ? parseTisText(new TextDecoder().decode(u8))
            : null;
        return parsed ?? rawImageBundle(u8, actionIndex, coin);
    } catch {
        return null;
    }
}

// Same ceiling the gated-file viewer puts on inline previews, so an
// oversized FILE never becomes a token picture either.
const MAX_RAW_IMAGE_BYTES = 5 * 1024 * 1024;

// A DESCRIPTION pointer may name a FILE that is the picture itself rather
// than a TIS document. The bytes decide (the on-chain MIME is issuer text):
// a raster image or an SVG becomes the token's single picture, and anything
// else stays "no bundle". The picture travels as a data: URL built from the
// bytes already in hand, because every shell's CSP admits data: images but
// no remote image origin, and a string survives the token-info cache and a
// messaging hop where a blob: URL would not. <img> keeps an SVG script-inert.
// Typed `large` so it serves as header icon, hero and gallery entry at once.
function rawImageBundle(bytes, actionIndex, coin) {
    if (bytes.length > MAX_RAW_IMAGE_BYTES) return null;
    const url = imagePreviewDataUrl(bytes);
    if (!url) return null;
    const bundle = tisToMediaBundle({});
    bundle.images.push({
        url,
        dataRef: coin ? `action:${coin}:${actionIndex}` : `action:${actionIndex}`,
        type: 'large',
        name: null,
    });
    return bundle;
}

// LINKed file metadata narrows the raw reads to declared pictures, while the
// bytes still decide whether a candidate is safe to render as artwork.
async function fetchLinkedArtworkBundle(sdk, raw) {
    if (typeof sdk?.getGatedFileRaw !== 'function') return null;
    const row = Array.isArray(raw) ? raw[0] : raw;
    const files = Array.isArray(row?.linked_files) ? row.linked_files : [];
    for (const file of files) {
        const declaredType = String(file?.type || '').toLowerCase();
        if (file?.gated || file?.action_index == null || !declaredType.startsWith('image/')) continue;
        try {
            const result = await readRawFile(sdk, String(file.action_index));
            if (result.state !== 'ready') continue;
            const bytes = result.bytes instanceof Uint8Array
                ? result.bytes
                : new Uint8Array(/** @type {any} */ (result.bytes));
            const bundle = rawImageBundle(bytes, file.action_index, null);
            if (bundle) return bundle;
        } catch {
            // Try the next LINKed picture when one raw endpoint cannot answer.
        }
    }
    return null;
}

// Shared TIS text → media-bundle path for the off-chain (URL fetch) and
// on-chain (raw FILE bytes) document sources.
function parseTisText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { return null; }
    if (!validateTisDocument(parsed)) return null;
    return tisToMediaBundle(parsed);
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
 * @param {boolean} [params.demo]
 * @param {boolean} [params.metadataFetchEnabled]
 * @param {typeof fetch} [params.fetch]
 * @param {boolean} [params.fresh]  read the token row past the explorer
 *        wrapper's read reuse and the HTTP cache, for a caller that judges a
 *        signature on its list pointers
 * @returns {Promise<TokenInfo>}
 */
export async function tokenInfoFor({
    sdkRegistry,
    chainId,
    tick,
    demo = false,
    metadataFetchEnabled = true,
    fetch: fetchImpl,
    fresh = false,
}) {
    if (!sdkRegistry) throw new Error('tokenInfoFor: sdkRegistry is required');
    if (!chainId) throw new Error('tokenInfoFor: chainId is required');
    if (!tick) throw new Error('tokenInfoFor: tick is required');
    const sdk = sdkRegistry.get(chainId);
    let raw = demo ? demoRowFor(tick) : null;
    // A read the explorer failed to answer is not a token it does not know.
    let readFailed = false;
    if (!demo && typeof sdk?.getToken === 'function') {
        try {
            raw = fresh ? await sdk.getToken(tick, { fresh: true }) : await sdk.getToken(tick);
        } catch {
            raw = null;
            readFailed = true;
        }
    }
    // Owner-attached FILE+LINK content is one bulk token query, never one
    // action read per tile. The token endpoint's embedded list is capped at
    // ten rows, so this read is required for galleries with 25 or more files.
    if (!demo && raw && typeof sdk?.getFiles === 'function') {
        try {
            const response = await sdk.getFiles(tick, 'token', { limit: 100 });
            const files = Array.isArray(response) ? response : (Array.isArray(response?.data) ? response.data : []);
            const row = Array.isArray(raw) ? raw[0] : raw;
            if (row && typeof row === 'object') {
                const linkedFiles = files.map((file) => ({
                    ...file,
                    url: file?.action_index != null && typeof sdk.fileRawUrl === 'function'
                        ? sdk.fileRawUrl(String(file.action_index))
                        : null,
                }));
                raw = Array.isArray(raw)
                    ? [{ ...row, linked_files: linkedFiles }, ...raw.slice(1)]
                    : { ...row, linked_files: linkedFiles };
            }
        } catch {
            // Keep the token endpoint's bounded linked_files fallback.
        }
    }
    let tisBundle = null;
    let tisAttempted = false;
    if (metadataFetchEnabled && !demo) {
        const row = Array.isArray(raw) ? raw[0] : raw;
        const description = row?.info?.description;
        const actionRef = typeof description === 'string'
            ? description.trim().match(TIS_ACTION_REF_RE)
            : null;
        const resolvedFetch = fetchImpl
            || (typeof fetch === 'function' ? fetch : null);
        if (actionRef) {
            tisAttempted = true;
            // On-chain TIS document; resolve through the same explorer
            // the token row came from (no external fetch).
            tisBundle = await fetchOnChainTisBundle({ sdk, actionIndex: actionRef[2], coin: actionRef[1] || null });
        } else if (description && resolvedFetch && tisDescriptionReference(description)) {
            tisAttempted = true;
            tisBundle = await fetchTisBundle({
                description,
                fetch: resolvedFetch,
                sdk,
            });
        }
    }
    // Demo entries use their bundled TIS document without attempting the
    // public description URL, keeping synthetic wallets offline.
    if (!tisBundle && demo) {
        const fixture = DEMO_TIS_BY_TICK[String(tick || '').toUpperCase()];
        if (fixture?.tis) tisBundle = tisToMediaBundle(fixture.tis);
    }
    // A TIS picture remains authoritative. Only when it has no artwork do
    // owner-approved FILE+LINK bytes supply the token image.
    const linkedArtworkBundle = metadataFetchEnabled && !demo && !tisBundle?.images?.length
        ? await fetchLinkedArtworkBundle(sdk, raw)
        : null;
    if (!demo) resolveMediaDataRefs(tisBundle, sdk);
    const info = normalizeTokenInfo(chainId, tick, raw, tisBundle, {
        allowRemoteMedia: metadataFetchEnabled && !demo,
        tisReadError: tisAttempted && !tisBundle,
        fallbackImages: linkedArtworkBundle?.images || [],
    });
    // Marks a record built without the explorer's answer, so callers neither
    // cache it nor present its empty fields as the token's real state.
    if (readFailed) info.loadError = true;
    return info;
}

// Resolve on-chain media references (dataRef = "action:<index>") across a
// bundle's media arrays to the configured explorer's raw FILE URL so the
// renderers get a plain `src`. Locked entries remain unresolved because their
// raw FILE bytes are ciphertext. Entries stay dataRef-annotated either way.
export function resolveMediaDataRefs(bundle, sdk) {
    if (!bundle || typeof sdk?.fileRawUrl !== 'function') return bundle;
    for (const key of ['images', 'audio', 'video', 'files']) {
        const arr = bundle[key];
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
            if (!entry || entry.locked || entry.url || !(entry.dataRef)) continue;
            const parsed = parseTisActionRef(entry.dataRef);
            if (!parsed) continue;
            try { entry.url = sdk.fileRawUrl(parsed.index, parsed.coin); } catch { /* leave unresolved */ }
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

// Inline icon tile for a demo-issued token (no remote image, so the demo
// stays offline and inside the app's img-src policy).
function demoIssuedIcon(label, from, to) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="118" font-family="system-ui,sans-serif" font-size="44" font-weight="800" fill="#FFFFFF" text-anchor="middle">${label}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const DEMO_OWNER_ADDRESS = 'bc1qdemowalletissuer0xchain0sunrise0roasters';

// Hand-rolled demo TIS documents, keyed by ticker; mirrors the TIS v1.0.0
// shape so they flow through `tisToMediaBundle` unchanged. URLs point at
// publicly hosted, freely-redistributable media so an offline demo can
// still showcase the gallery in a connected browser.
const DEMO_TIS_BY_TICK = {
    // EXAMPLE is the fully-populated reference token. Its TIS document is
    // the standalone demoExampleTis.json file, which fills in every field
    // the Token Information Standard v1.0.0 defines: name, owner, contacts,
    // categories, social, images of every type, audio, video, files, dns,
    // packs, html, and a PGP signature. Look at this entry to see what a
    // maxed-out token info document renders like in the wallet.
    EXAMPLE: {
        // A description that is itself a JSON URL exercises the live
        // fetch+parse path; offline (the usual demo case) the wallet falls
        // back to the pre-built `tis` block below.
        description: 'https://explorer.xchain.io/asset/EXAMPLE/tis.json',
        owner: '1ExampLeTokenXChainDemoOwnerAddrXyz',
        supply: { current: '1000', max: '1000' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
        market: { price: 0.00005, floor: 0.00004 },
        tis: exampleTis,
    },
    // PEPECREATURE is a real Fake Rare card on Counterparty, reproduced here
    // so the demo shows an authentic on-chain token rather than a synthetic
    // one. The values mirror the live asset (issuer, supply 170, locked) and
    // its on-chain description JSON (creature.json). It is intentionally only
    // modestly populated, exactly like the real token; EXAMPLE above is the
    // every-field showcase.
    PEPECREATURE: {
        description: 'PEPECREATURE is not just another card. It is a STAMP inscribed directly into Bitcoin, a Fake Rare born of the old traditions, and the vessel for a book unlike any other.\n\nThis card carries its own engine, hosted on Arweave, that pulls the image out of Bitcoin itself. No fragile indexer. No single point of failure. Push the button on Tokenscan and watch the engine awaken, the same way FAKEDUST revealed an album inside a card.\n\nThis is a STAMP. This is a Fake Rare. This is permanence, lore, and unity fused together. Nothing like it exists.',
        owner: '1EbsYbJ8HcVtUeLX2iFLwRLABUKLpNzKga',
        supply: { current: '170', max: '170' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
        market: { price: 0.00420690, floor: 0.00298061 },
        tis: {
            tick: 'PEPECREATURE',
            name: 'PEPECREATURE',
            description: 'PEPECREATURE is not just another card. It is a STAMP inscribed directly into Bitcoin, a Fake Rare born of the old traditions, and the vessel for a book unlike any other.\n\nThis card carries its own engine, hosted on Arweave, that pulls the image out of Bitcoin itself. No fragile indexer. No single point of failure. Push the button on Tokenscan and watch the engine awaken, the same way FAKEDUST revealed an album inside a card.\n\nThis is a STAMP. This is a Fake Rare. This is permanence, lore, and unity fused together. Nothing like it exists.',
            website: 'https://fakeraredirectory.com/fake-rares/',
            websites: [
                'https://fakeraredirectory.com/fake-rares/',
                'https://kanemayfield.com/',
                'https://kanemayfield.com/FORGE/',
            ],
            // On-chain the `pgpsig` field carries only the artist's name.
            pgpsig: 'KANE MAYFIELD',
            owner: {
                name: 'Kane Mayfield',
                title: 'Artist',
            },
            categories: [
                { type: 'main', data: 'Artist, Band or Public Figure' },
                { type: 'sub', data: 'Art / Literature' },
            ],
            social: [
                { type: 'twitter', data: 'https://twitter.com/KaneMayfield' },
            ],
            images: [
                { type: 'icon', data: 'https://gousue3rn3uppml5r5hloc4wqmojl2cqxyhvhnceairxkccnw7vq.ar.io/M6kqE3Fu6PexfY9OtwuWgxyV6FC-D1O0RAIjdQhNt-s/pepecreature_thumb.png', name: 'PEPECREATURE' },
                { type: 'standard', data: 'https://gousue3rn3uppml5r5hloc4wqmojl2cqxyhvhnceairxkccnw7vq.ar.io/M6kqE3Fu6PexfY9OtwuWgxyV6FC-D1O0RAIjdQhNt-s/pepecreature_thumb.png', name: 'PEPECREATURE' },
                { type: 'large', data: 'https://gousue3rn3uppml5r5hloc4wqmojl2cqxyhvhnceairxkccnw7vq.ar.io/jDEXyFCLp7mv3IozMQ2WL_L-vgoYYWg6_EpKD_62pw4/pepecreature_full.jpg', name: 'PEPECREATURE (full)' },
            ],
            // Canonical on-chain media, matching the live asset. The ar.io
            // gateway can paywall (HTTP 402), so the player may not render
            // in the demo; the URL is kept faithful to Counterparty.
            video: [
                { type: 'mp4', data: 'https://2ouj2tu25j76b6ashak5jmpejzljqr4dyvpptdyk6tkoabu65mxq.ar.io/06idTprqf-D4EjgV1LHkTlaYR4PFXvmPCvTU4Aae6y8?/16tonspepe.mp4', name: '16 Tons Pepe' },
            ],
        },
    },
    RAREPEPE: {
        description: 'A classic Rare Pepe card from the Counterparty era, one of the original on-chain NFTs.',
        owner: '1RarePepe2WalletDemoBitcoinAddressXyz',
        supply: { current: '300', max: '300' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
        tis: {
            description: 'A classic Rare Pepe card from the Counterparty era, one of the original on-chain NFTs.',
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
    BITCRYSTAL: {
        description: 'A demo Bitcrystals collectible with a permanently locked supply.',
        owner: null,
        supply: { current: '1', max: '1' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
    },
    XCPCARD: {
        description: 'A demo XCP founders card with a permanently locked supply.',
        owner: null,
        supply: { current: '1', max: '1' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
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
                { type: 'github', data: 'https://github.com/XChain-Platform' },
            ],
            categories: [{ type: 'main', data: 'Showcase' }],
        },
    },
    // Tokens the demo wallet itself issued (see synthesizeDemoOwnedTokens).
    BEANCOIN: {
        description: 'Loyalty points for the Sunrise Roasters coffee network. Earn on every cup, spend at any cafe.',
        owner: DEMO_OWNER_ADDRESS,
        supply: { current: '1250000', max: '10000000' },
        locks: { description: false, max_supply: false, mint: false, mint_supply: false },
        market: { price: 0.00000084, floor: 0.00000071 },
        tis: {
            description: 'Loyalty points for the Sunrise Roasters coffee network. Earn on every cup, spend at any cafe.',
            images: [{ type: 'icon', data: demoIssuedIcon('BEAN', '#B45309', '#78350F') }],
            website: 'https://xchain.io',
            categories: [{ type: 'main', data: 'Loyalty and rewards' }],
        },
    },
    STUDIOPASS: {
        description: 'Lifetime member passes for Studio North, the shared creative workspace.',
        owner: DEMO_OWNER_ADDRESS,
        supply: { current: '500', max: '500' },
        locks: { description: false, max_supply: true, mint: true, mint_supply: true },
        market: { price: 0.0012, floor: 0.0009 },
        tis: {
            description: 'Lifetime member passes for Studio North, the shared creative workspace.',
            images: [{ type: 'icon', data: demoIssuedIcon('PASS', '#0E7490', '#1E3A8A') }],
            website: 'https://xchain.io',
            categories: [{ type: 'main', data: 'Memberships' }],
        },
    },
    HARBORFEST: {
        description: 'Weekend tickets for Harbor Fest 2027, the waterfront music and food festival.',
        owner: DEMO_OWNER_ADDRESS,
        supply: { current: '2000', max: '2000' },
        locks: { description: false, max_supply: true, mint: false, mint_supply: false },
        market: { price: 0.00048, floor: 0.0004 },
        tis: {
            description: 'Weekend tickets for Harbor Fest 2027, the waterfront music and food festival.',
            images: [{ type: 'icon', data: demoIssuedIcon('HARBR', '#BE185D', '#6D28D9') }],
            website: 'https://xchain.io',
            categories: [{ type: 'main', data: 'Events' }],
        },
    },
    XCP: {
        description: 'Counterparty (XCP): the original Bitcoin-based token protocol whose conventions XChain extends.',
        owner: null,
        supply: { current: '2649755.68', max: '2649755.68' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
        market: { price: 0.0001, floor: 0.00009 },
        tis: {
            description: 'Counterparty (XCP): the original Bitcoin-based token protocol whose conventions XChain extends.',
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
        description: 'PEPECASH, the currency of the Rare Pepe ecosystem.',
        owner: null,
        supply: { current: '700000000', max: '1000000000' },
        locks: { description: true, max_supply: true, mint: false, mint_supply: false },
        market: { price: 0.0000012, floor: 0.0000010 },
        tis: {
            description: 'PEPECASH, the currency of the Rare Pepe ecosystem.',
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
        description: 'A Doginal, a Dogecoin-inscribed digital collectible.',
        owner: null,
        supply: { current: '1', max: '1' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
        tis: {
            description: 'A Doginal, a Dogecoin-inscribed digital collectible.',
            images: [
                { type: 'icon', data: 'https://upload.wikimedia.org/wikipedia/en/d/d0/Dogecoin_Logo.png' },
            ],
            categories: [{ type: 'main', data: 'Collectibles' }],
            website: 'https://dogecoin.com',
        },
    },
    LITEORD: {
        description: 'A demo Litecoin ordinal with a permanently locked supply.',
        owner: null,
        supply: { current: '1', max: '1' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
    },
    MIMBLEPUNK: {
        description: 'A demo MimblePunk collectible with a permanently locked supply.',
        owner: null,
        supply: { current: '1', max: '1' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
    },
    MEMECARD: {
        description: 'A demo Dogecoin meme card with a permanently locked supply.',
        owner: null,
        supply: { current: '1', max: '1' },
        locks: { description: true, max_supply: true, mint: true, mint_supply: true },
    },
};
