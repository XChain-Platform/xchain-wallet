// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const LIST_META_NAME_MAX_BYTES = 64;
export const LIST_META_DESCRIPTION_MAX_BYTES = 512;

/** @param {unknown} value @returns {number} */
export function utf8ByteLength(value) {
    return new TextEncoder().encode(value == null ? '' : String(value)).length;
}

/**
 * @param {'name' | 'description'} field
 * @param {unknown} value
 * @param {{ isCreate: boolean }} options
 * @returns {'pipe' | 'semicolon' | 'length' | 'format' | null}
 */
export function listMetaInputError(field, value, { isCreate } = { isCreate: false }) {
    const text = value == null ? '' : String(value);
    if (text === '') return null;
    if (text.includes('|')) return 'pipe';
    if (text.includes(';')) return 'semicolon';
    const maxBytes = field === 'description'
        ? LIST_META_DESCRIPTION_MAX_BYTES
        : LIST_META_NAME_MAX_BYTES;
    if (utf8ByteLength(text) > maxBytes) return 'length';
    if (isCreate && text === '-') return 'format';
    return null;
}
