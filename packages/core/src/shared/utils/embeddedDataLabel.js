// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatBytes } from './formatBytes.js';

// A token file whose address is an inline data: URL carries the whole file in
// that string, so printing it puts kilobytes of base64 on the card. Cards show
// this short label in its place. The label is built only from a fixed format
// table and the decoded size, never from the issuer's own MIME text.

const DATA_URL_RE = /^\s*data:/i;

const IMAGE_FORMATS = {
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'image/bmp': 'BMP',
    'image/svg+xml': 'SVG',
};

/** True when the value is an inline data: URL rather than an address. */
export function isDataUrl(value) {
    return typeof value === 'string' && DATA_URL_RE.test(value);
}

// Decoded byte count of the payload after the first comma: base64 counts
// three bytes per four characters less padding; any other payload counts its
// percent-decoded UTF-8 bytes.
function payloadBytes(header, payload) {
    if (/;base64$/i.test(header)) {
        const clean = payload.replace(/\s+/g, '');
        const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
        return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
    }
    try {
        return new TextEncoder().encode(decodeURIComponent(payload)).length;
    } catch {
        return payload.length;
    }
}

/**
 * "Embedded image (SVG, 1.2 KB)" for a picture in one of the formats the
 * wallet draws, "Embedded file (3 KB)" for anything else, or null when the
 * value is not a data: URL.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function embeddedDataLabel(value) {
    if (!isDataUrl(value)) return null;
    const body = value.trim().slice('data:'.length);
    const comma = body.indexOf(',');
    if (comma < 0) return 'Embedded file';
    const header = body.slice(0, comma);
    const mime = header.split(';')[0].trim().toLowerCase();
    const size = formatBytes(payloadBytes(header, body.slice(comma + 1)));
    const format = IMAGE_FORMATS[mime];
    return format ? `Embedded image (${format}, ${size})` : `Embedded file (${size})`;
}
