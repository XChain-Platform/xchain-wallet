// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { neutralizeControlText } from './textHardening.js';

/**
 * Build a safe display label for a list.
 *
 * @param {string | number} index
 * @param {unknown} name
 * @param {string} [kind]
 * @returns {string}
 */
export function listLabel(index, name, kind = 'List') {
    const baseLabel = `${kind} #${index}`;
    if (typeof name !== 'string' || name.length === 0) return baseLabel;
    return `${neutralizeControlText(name)} (List #${index})`;
}

/**
 * The text an Allow list or Block list picker field shows (G114): the picked
 * list's name while `pick` still describes the field's index, "List #N" when
 * the list has no name or the index came from a draft or preset, and null
 * for an empty field so it reads "None set".
 *
 * @param {string | number | null | undefined} index
 * @param {{ index: string, name?: unknown } | null | undefined} pick
 * @returns {string | null}
 */
export function pickedListText(index, pick) {
    const value = String(index ?? '').trim();
    if (!value) return null;
    return listLabel(value, pick && pick.index === value ? pick.name : null);
}
