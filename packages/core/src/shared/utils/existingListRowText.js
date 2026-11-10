// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { currentListItems } from '../../flows/listMembership.js';
import { neutralizeControlText } from './textHardening.js';

/**
 * Build the one-line list description used in both the chooser and its
 * selected value. Unnamed token lists are recognizable by their tickers,
 * while unnamed address lists stay recognizable by their size.
 *
 * @param {any} list
 * @returns {string}
 */
export function existingListRowText(list) {
    const type = String(list?.type ?? (list?.kind === 'tick' ? '1' : list?.kind === 'address' ? '2' : ''));
    const items = currentListItems(list);
    const count = Number.isInteger(list?.memberCount)
        ? list.memberCount
        : Array.isArray(items) ? items.length : null;
    const label = neutralizeControlText(list?.label) || neutralizeControlText(list?.name);

    if (type === '1') {
        const ticks = (items || []).map((item) => neutralizeControlText(
            item && typeof item === 'object' ? item.tick ?? item.ticker ?? item.name : item,
        )).filter(Boolean);
        const derivedName = ticks.length === 1
            ? `${ticks[0]} holders`
            : ticks.length === 2
                ? `${ticks[0]} and ${ticks[1]} holders`
                : ticks.length > 2
                    ? `${ticks[0]} and ${ticks[1]} +${ticks.length - 2} more holders`
                    : 'Token holders';
        const size = count == null ? 'size unavailable' : `${count} token${count === 1 ? '' : 's'}`;
        return `${label || derivedName}, token list, ${size}`;
    }

    if (type === '3') {
        const size = count == null ? 'size unavailable' : `${count} member${count === 1 ? '' : 's'}`;
        return `${label || `List #${list?.action_index ?? '?'}`}, union list, ${size}`;
    }

    const size = count == null ? 'size unavailable' : `${count} address${count === 1 ? '' : 'es'}`;
    return `${label || (count == null ? 'Address list' : size)}, address list, ${size}`;
}
