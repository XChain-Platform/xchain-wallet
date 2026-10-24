// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Contact record (§11.3.4). Address-book entry. One contact may span
// multiple chains via the `entries` array.

import {
    check,
    checkEach,
    isIsoTimestamp,
    isNonEmptyString,
    isPlainObject,
    isString,
    result,
} from './validate.js';
import { randomUUID } from '../util/uuid.js';
import { BIDI_CONTROLS, CONTROLS, HIDDEN_MARKS } from '../shared/utils/textHardening.js';

export const CURRENT_VERSION = 1;

// Characters that change how a name reads without being visible: control
// characters, zero-width characters, and the bidirectional embeddings,
// overrides and isolates. A name carrying them can display as a different name
// than the one stored, or sit beside a lookalike with no visible difference.
// The classes are the ones neutralizeControlText uses for display, so a stored
// name and a displayed one agree. The zero-width joiners U+200C and U+200D
// stay, since Persian and Indic names spell with them.
const NAME_ZERO_WIDTH = /[\u200B\u2060\uFEFF]/g;

/**
 * Contact name as it is stored and compared: invisible and control characters
 * removed (controls become spaces), runs of whitespace collapsed, ends trimmed.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function cleanContactName(name) {
    return String(name ?? '')
        .replace(CONTROLS, ' ')
        .replace(BIDI_CONTROLS, '')
        .replace(HIDDEN_MARKS, '')
        .replace(NAME_ZERO_WIDTH, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @typedef {Object} ContactEntry
 * @property {string} chain
 * @property {string} address
 * @property {string} label
 */

/**
 * @typedef {Object} Contact
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {string} notes
 * @property {ContactEntry[]} entries
 * @property {string} avatarSeed
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @param {Object} input
 * @param {string} input.name
 * @param {ContactEntry[]} input.entries  at least one entry required
 * @param {string} [input.notes]
 * @param {string} [input.avatarSeed]     defaults to first entry's address
 * @returns {Contact}
 */
export function createContact(input) {
    const now = new Date().toISOString();
    const avatarSeed = input.avatarSeed ?? input.entries[0]?.address ?? '';
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        name: input.name,
        notes: input.notes ?? '',
        entries: input.entries,
        avatarSeed,
        createdAt: now,
        updatedAt: now,
    };
}

const isContactEntry = (v) =>
    isPlainObject(v) &&
    isNonEmptyString(v.chain) &&
    isNonEmptyString(v.address) &&
    isString(v.label);

export function validateContact(record) {
    const errors = [];
    if (!check(errors, 'contact', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {Contact} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'name', isNonEmptyString(r.name), 'must be a non-empty string');
    check(errors, 'notes', isString(r.notes), 'must be a string');
    checkEach(errors, 'entries', r.entries, isContactEntry, 'malformed');
    check(errors, 'avatarSeed', isString(r.avatarSeed), 'must be a string');
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    check(errors, 'updatedAt', isIsoTimestamp(r.updatedAt), 'must be an ISO timestamp');
    return result(errors);
}
