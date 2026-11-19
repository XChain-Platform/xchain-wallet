// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The protocol's MESSAGE has no attachment field, so the wallet sends plain
// text only. Older wallet builds appended an envelope after the text; a
// received message that carries a well-formed one still shows its text, with
// the envelope (and its base64) hidden and never offered as a file.
const ATTACHMENT_MARKER = '\n\n[[xchain-attachment:v1]]\n';

const LEGACY_ENVELOPE_TYPES = Object.freeze([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
]);

const LEGACY_ENVELOPE_MAX_BYTES = 256 * 1024;

/**
 * Splits a legacy attachment envelope off a message body and returns only the
 * visible text. Only a well-formed envelope is stripped; a malformed or
 * unsupported one stays in the text as ordinary characters.
 *
 * @param {unknown} value
 * @returns {{ text: string }}
 */
export function parseMessageContent(value) {
    const original = typeof value === 'string' ? value : '';
    const markerAt = original.lastIndexOf(ATTACHMENT_MARKER);
    if (markerAt < 0) return { text: original };
    try {
        const parsed = JSON.parse(original.slice(markerAt + ATTACHMENT_MARKER.length));
        const type = typeof parsed?.type === 'string' ? parsed.type.toLowerCase() : '';
        const name = typeof parsed?.name === 'string' ? parsed.name : '';
        const dataUrl = typeof parsed?.dataUrl === 'string' ? parsed.dataUrl : '';
        const size = Number(parsed?.size);
        const expectedPrefix = `data:${type};base64,`;
        const payload = dataUrl.startsWith(expectedPrefix)
            ? dataUrl.slice(expectedPrefix.length)
            : '';
        const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
        const decodedSize = payload.length % 4 === 0
            ? ((payload.length / 4) * 3) - padding
            : -1;
        if (!LEGACY_ENVELOPE_TYPES.includes(type)
            || !name || name.length > 255
            || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)
            || !Number.isSafeInteger(size) || size < 1 || size > LEGACY_ENVELOPE_MAX_BYTES
            || decodedSize !== size) {
            return { text: original };
        }
        return { text: original.slice(0, markerAt) };
    } catch {
        return { text: original };
    }
}
