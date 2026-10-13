// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const ATTACHMENT_MARKER = '\n\n[[xchain-attachment:v1]]\n';

export const MESSAGE_ATTACHMENT_TYPES = Object.freeze([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
]);

export const MAX_MESSAGE_ATTACHMENT_BYTES = 256 * 1024;

/**
 * Adds one compact attachment envelope to a MESSAGE body. Clients that do not
 * recognize the envelope still retain the human-readable message before it.
 *
 * @param {string} text
 * @param {{ name: string, type: string, dataUrl: string, size: number } | null} attachment
 * @returns {string}
 */
export function serializeMessageContent(text, attachment) {
    if (!attachment) return text;
    return `${text}${ATTACHMENT_MARKER}${JSON.stringify({
        name: attachment.name,
        type: attachment.type,
        dataUrl: attachment.dataUrl,
        size: attachment.size,
    })}`;
}

/**
 * Separates a wallet attachment envelope from its visible message text.
 * Malformed or unsupported envelopes remain ordinary text and never become a
 * clickable attachment.
 *
 * @param {unknown} value
 * @returns {{ text: string, attachment: { name: string, type: string, dataUrl: string, size: number } | null }}
 */
export function parseMessageContent(value) {
    const original = typeof value === 'string' ? value : '';
    const markerAt = original.lastIndexOf(ATTACHMENT_MARKER);
    if (markerAt < 0) return { text: original, attachment: null };
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
        if (!MESSAGE_ATTACHMENT_TYPES.includes(type)
            || !name || name.length > 255
            || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)
            || !Number.isSafeInteger(size) || size < 1 || size > MAX_MESSAGE_ATTACHMENT_BYTES) {
            return { text: original, attachment: null };
        }
        if (decodedSize !== size) return { text: original, attachment: null };
        return {
            text: original.slice(0, markerAt),
            attachment: { name, type, dataUrl, size },
        };
    } catch {
        return { text: original, attachment: null };
    }
}
