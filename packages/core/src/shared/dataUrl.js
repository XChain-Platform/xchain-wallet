// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Turn a `data:` URL into a Blob WITHOUT going through `fetch()`.
//
// The obvious one-liner, `(await fetch(dataUrl)).blob()`, is a network
// request as far as Content Security Policy is concerned, and every shell
// pins `connect-src` to the wallet's own origin plus its API hosts. None of
// them lists `data:`, and none should: widening connect-src to let an image
// round-trip through the fetch layer is the wrong trade. So on web, desktop
// and mobile the fetch was refused and the user saw "Copy failed: Failed to
// fetch" on the Receive screen's Copy QR / Share QR buttons. Decoding the
// payload in-process needs no network permission at all.

const DATA_URL_RE = /^data:([^,]*?)(;base64)?,(.*)$/s;

/**
 * Parse a `data:` URL into its MIME type and raw bytes.
 *
 * Handles both the base64 form (`data:image/png;base64,...`, what
 * `QRCode.toDataURL` and `canvas.toDataURL` emit) and the percent-encoded
 * text form (`data:text/plain,hello%20world`). A missing MIME type defaults
 * to `text/plain` per RFC 2397; any extra parameters (`;charset=utf-8`) are
 * dropped from the returned type, since Blob only carries the media type.
 *
 * @param {string} dataUrl
 * @returns {{ type: string, bytes: Uint8Array }}
 * @throws {Error} when the string is not a data URL or its payload is not valid base64
 */
export function parseDataUrl(dataUrl) {
    const m = DATA_URL_RE.exec(String(dataUrl ?? ''));
    if (!m) throw new Error('Not a data: URL');
    const [, meta, base64Flag, payload] = m;
    const type = (meta.split(';')[0] || 'text/plain').trim().toLowerCase();

    if (base64Flag) {
        const bin = decodeBase64(payload);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return { type, bytes };
    }
    // Text form: the payload is percent-encoded UTF-8.
    const text = decodeURIComponent(payload);
    return { type, bytes: new TextEncoder().encode(text) };
}

/**
 * The Blob for a `data:` URL, typed with its media type.
 *
 * @param {string} dataUrl
 * @returns {Blob}
 */
export function dataUrlToBlob(dataUrl) {
    const { type, bytes } = parseDataUrl(dataUrl);
    return new Blob([bytes], { type });
}

/**
 * @param {string} payload
 * @returns {string} binary string
 */
function decodeBase64(payload) {
    // Data URLs may carry whitespace/newlines inside the base64 run; atob
    // rejects those, so strip them the way browsers do.
    const clean = payload.replace(/\s+/g, '');
    if (typeof atob === 'function') return atob(clean);
    // Node without a global atob (pre-16); the browser bundles never hit this.
    return Buffer.from(clean, 'base64').toString('binary');
}
