// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A connected site's own icon, as stored on its ConnectedSite record.
//
// The content script rasterizes the page's declared icon to a PNG inside the
// requesting page (contentScript.js, captureSiteIcon) so the wallet never
// fetches a site's artwork itself. Everything here treats the result as
// untrusted page data: the only accepted form is a small base64 PNG data URL,
// checked by prefix, charset, decoded size, PNG signature and IHDR
// dimensions, and anything else collapses to null. The value is only ever
// rendered as `<img src>`, never as markup.

import { isIsoTimestamp } from './validate.js';

/** Largest edge the capture produces, in pixels. */
export const SITE_ICON_MAX_PX = 128;
/** Largest decoded PNG the record accepts, in bytes. */
export const SITE_ICON_MAX_BYTES = 32 * 1024;
export const SITE_ICON_PREFIX = 'data:image/png;base64,';

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// 4-byte length, then the chunk type, which must be IHDR first.
const IHDR = [0x49, 0x48, 0x44, 0x52];

function decodeBase64Head(base64) {
    if (typeof atob === 'function') return atob(base64);
    return Buffer.from(base64, 'base64').toString('binary');
}

/**
 * True when `value` is a PNG data URL the wallet will store and render as a
 * site icon: base64, at most SITE_ICON_MAX_BYTES decoded, a real PNG header,
 * and both edges between 1 and SITE_ICON_MAX_PX.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isSiteIconDataUrl(value) {
    if (typeof value !== 'string' || !value.startsWith(SITE_ICON_PREFIX)) return false;
    const payload = value.slice(SITE_ICON_PREFIX.length);
    // A cheap ceiling first, so an oversized string is never scanned.
    if (payload.length === 0 || payload.length % 4 !== 0) return false;
    if (payload.length > Math.ceil(SITE_ICON_MAX_BYTES / 3) * 4) return false;
    if (!BASE64_RE.test(payload)) return false;
    const padding = payload.endsWith('==') ? 2 : (payload.endsWith('=') ? 1 : 0);
    if ((payload.length / 4) * 3 - padding > SITE_ICON_MAX_BYTES) return false;
    // 24 bytes: signature (8) + IHDR length (4) + type (4) + width (4) + height (4).
    let head;
    try {
        head = decodeBase64Head(payload.slice(0, 32));
    } catch {
        return false;
    }
    if (head.length < 24) return false;
    for (let i = 0; i < 8; i += 1) {
        if (head.charCodeAt(i) !== PNG_SIGNATURE[i]) return false;
    }
    for (let i = 0; i < 4; i += 1) {
        if (head.charCodeAt(12 + i) !== IHDR[i]) return false;
    }
    const u32 = (offset) => (
        ((head.charCodeAt(offset) << 24) >>> 0)
        + (head.charCodeAt(offset + 1) << 16)
        + (head.charCodeAt(offset + 2) << 8)
        + head.charCodeAt(offset + 3)
    );
    const width = u32(16);
    const height = u32(20);
    return width >= 1 && height >= 1 && width <= SITE_ICON_MAX_PX && height <= SITE_ICON_MAX_PX;
}

/**
 * The icon to store, or null for anything that is not a valid site icon.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function sanitizeSiteIcon(value) {
    return isSiteIconDataUrl(value) ? value : null;
}

/**
 * Fill the icon fields on a ConnectedSite read from storage or a backup.
 * Records written before site icons existed carry neither field, and a
 * tampered value is dropped rather than failing the whole record, so every
 * reader sees `icon` as a valid data URL or null and `iconCapturedAt` as an
 * ISO string exactly when an icon is present.
 *
 * @template {Record<string, unknown>} T
 * @param {T} record
 * @returns {T & { icon: string | null, iconCapturedAt: string | null }}
 */
export function withSiteIconFields(record) {
    if (!record || typeof record !== 'object') return record;
    const icon = sanitizeSiteIcon(record.icon);
    const capturedAt = icon && isIsoTimestamp(record.iconCapturedAt)
        ? record.iconCapturedAt
        : null;
    if (record.icon === icon && record.iconCapturedAt === capturedAt) return record;
    return { ...record, icon, iconCapturedAt: capturedAt };
}

/**
 * Up to two letters for a site with no icon: the first letters of the first
 * two words of its declared name, else the first two letters of a one-word
 * name, else of the host label before the TLD (app.uniswap.org gives "UN"),
 * else "?". The Connected Sites view uses the same rule, seeded by origin.
 *
 * @param {string} [name]
 * @param {string} [origin]
 * @returns {string}
 */
export function siteInitials(name, origin) {
    // The connect handler defaults appName to the origin itself, which names
    // nothing: "https://..." would give "HT".
    const declared = /^[a-z][a-z0-9+.-]*:\/\//i.test(String(name || '').trim()) ? '' : String(name || '');
    const words = declared.trim().split(/\s+/)
        .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter(Boolean);
    if (words.length >= 2) return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
    let label = '';
    try {
        const host = new URL(String(origin || '')).hostname.replace(/^www\./, '');
        const labels = host.split('.').filter(Boolean);
        label = (labels.length >= 2 ? labels[labels.length - 2] : labels[0]) || '';
    } catch { /* no usable origin */ }
    const source = (words[0] || label).replace(/[^\p{L}\p{N}]/gu, '');
    return Array.from(source).slice(0, 2).join('').toUpperCase() || '?';
}
