// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { neutralizeControlText } from './textHardening.js';

/**
 * Build a safe display label for a list.
 *
 * @param {string | number} index
 * @param {unknown} name
 * @returns {string}
 */
export function listLabel(index, name) {
    const baseLabel = `List #${index}`;
    if (typeof name !== 'string' || name.length === 0) return baseLabel;
    return `${neutralizeControlText(name)} (${baseLabel})`;
}
