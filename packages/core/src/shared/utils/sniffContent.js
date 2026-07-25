// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Byte-level content sniffing for unlocked gated files (PC-27).
//
// Anyone can be a gated-content issuer, so decrypted plaintext is
// attacker-controlled and the on-chain declared MIME type is an
// attacker-controlled string. The viewer therefore decides HOW to
// present bytes from the bytes alone; the declared type is cosmetic
// (row labels, icons) and never a rendering input.
//
// Classification is deliberately narrow. Only formats the wallet can
// present through a script-inert surface classify as renderable:
//   - 'image': raster formats with unambiguous magic bytes, shown via
//     <img> (no script context exists for a raster image).
//   - 'svg': XML whose root element is <svg>. Shown ONLY via <img>,
//     where the SVG-as-image context disables scripts, external loads,
//     and foreignObject interactivity. Never rendered as a document.
//   - 'text': valid UTF-8 with no NULs and a low control-char ratio,
//     shown as a DOM text node (React escapes it; HTML/JS source is
//     displayed, not interpreted).
// Everything else - including PDF, which embeds script in some
// viewers - is 'binary' or 'pdf': download-only, no inline surface.

const RASTER_MAGIC = [
    { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
    { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },          // GIF8
    { mime: 'image/bmp', bytes: [0x42, 0x4d] },                       // BM
];

function startsWith(bytes, sig, offset = 0) {
    if (bytes.length < offset + sig.length) return false;
    for (let i = 0; i < sig.length; i += 1) {
        if (bytes[offset + i] !== sig[i]) return false;
    }
    return true;
}

/**
 * Decode a UTF-8 prefix strictly. Returns null when the bytes are not
 * valid UTF-8 (TextDecoder fatal mode; Buffer fallback re-encodes and
 * compares for hosts without TextDecoder).
 *
 * @param {Uint8Array} bytes
 * @returns {string | null}
 */
function decodeUtf8Strict(bytes) {
    if (typeof TextDecoder === 'function') {
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (_e) {
            return null;
        }
    }
    const buf = Buffer.from(bytes);
    const text = buf.toString('utf8');
    // Round-trip check: lossy decodes insert U+FFFD and won't re-encode
    // to the original bytes.
    return Buffer.from(text, 'utf8').equals(buf) ? text : null;
}

/**
 * True when a decoded string looks like human-presentable text: no
 * NULs and less than 5% non-whitespace control characters.
 *
 * @param {string} text
 */
function looksLikeText(text) {
    if (text.length === 0) return false;
    let control = 0;
    for (let i = 0; i < text.length; i += 1) {
        const c = text.charCodeAt(i);
        if (c === 0) return false;
        if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) control += 1;
    }
    return control / text.length < 0.05;
}

/**
 * Detect an <svg> root: optional BOM, whitespace, XML declaration,
 * comments, and DOCTYPE may precede it. Anything else before the first
 * element (e.g. an <html> root) means "not SVG".
 *
 * @param {string} text
 */
function isSvgDocument(text) {
    let s = text.replace(/^\uFEFF/, '');
    // Strip leading whitespace / XML decl / comments / doctype, in any
    // order, without ever skipping a real element.
    for (;;) {
        const before = s;
        s = s.replace(/^\s+/, '');
        s = s.replace(/^<\?xml[\s\S]*?\?>/i, '');
        s = s.replace(/^<!--[\s\S]*?-->/, '');
        s = s.replace(/^<!DOCTYPE[^>]*>/i, '');
        if (s === before) break;
    }
    return /^<svg[\s>]/i.test(s);
}

/**
 * @typedef {Object} SniffedContent
 * @property {'image' | 'svg' | 'text' | 'pdf' | 'binary'} kind
 * @property {string | null} mime   sniffed MIME, null when unknown ('binary')
 */

/**
 * Classify plaintext bytes for presentation. Pure function of the
 * bytes; the on-chain declared type must never be passed in.
 *
 * @param {Uint8Array} bytes
 * @returns {SniffedContent}
 */
export function sniffContent(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        return { kind: 'binary', mime: null };
    }

    for (const { mime, bytes: sig } of RASTER_MAGIC) {
        if (startsWith(bytes, sig)) return { kind: 'image', mime };
    }
    // WebP: RIFF....WEBP
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
        && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
        return { kind: 'image', mime: 'image/webp' };
    }
    // %PDF-
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
        return { kind: 'pdf', mime: 'application/pdf' };
    }

    const text = decodeUtf8Strict(bytes);
    if (text !== null && looksLikeText(text)) {
        if (isSvgDocument(text)) return { kind: 'svg', mime: 'image/svg+xml' };
        return { kind: 'text', mime: 'text/plain' };
    }

    return { kind: 'binary', mime: null };
}

/** Kinds the viewer may render inline; everything else is download-only. */
export function isInlineRenderableKind(kind) {
    return kind === 'image' || kind === 'svg' || kind === 'text';
}
