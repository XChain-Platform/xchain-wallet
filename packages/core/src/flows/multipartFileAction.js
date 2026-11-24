// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wire string of a public multi-part FILE action: the manifest (format 1)
// and a part (format 2). SDK releases before 0.28 know only format 0 and refuse
// both ("FILE requires field: TYPE"), so the wallet serializes these formats as
// the SDK's format selector serializes any action: the action, its version, then
// every field of the format in order, with trailing empty fields trimmed. A
// gated manifest rides a BATCH instead (gatedMultipartBatch.js), which the SDK
// composes itself.

const FORMAT_FIELDS = Object.freeze({
    1: Object.freeze([
        'FILE_HASH', 'TOTAL_PARTS', 'TOTAL_BYTES', 'NAME', 'TYPE', 'TITLE', 'MEMO',
        'GATE_TICKER', 'ENCRYPTION_METHOD', 'KEY_HASH', 'GATE_MIN_AMOUNT', 'COMPRESSION',
    ]),
    2: Object.freeze(['FILE_HASH', 'PART_INDEX']),
});

function invalidField(field) {
    const error = new Error(`Invalid multi-part FILE field: ${field}`);
    error.code = 'FILE_MULTIPART_FIELD_INVALID';
    return error;
}

function fieldValue(params, field) {
    const value = params[field];
    const text = value === undefined || value === null ? '' : String(value);
    // A pipe would shift every later field of the action on the wire.
    if (text.includes('|')) throw invalidField(field);
    return text;
}

/**
 * The action string for a FILE format 1 or 2 action, or null for any other
 * action so the caller composes it through the SDK.
 *
 * @param {{ action?: string, params?: Record<string, unknown> }} actionData
 * @returns {string | null}
 */
export function multipartFileActionString(actionData) {
    if (actionData?.action !== 'FILE') return null;
    const params = actionData.params || {};
    const version = String(params.VERSION ?? '');
    const fields = FORMAT_FIELDS[version];
    if (!fields) return null;
    const parts = ['FILE', version, ...fields.map((field) => fieldValue(params, field))];
    while (parts.length > 2 && parts[parts.length - 1] === '') parts.pop();
    return parts.join('|');
}
