// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { neutralizeControlText } from './textHardening.js';
import { validActionIndex } from './sharedBlockPick.js';

// Every directory field is indexer text, so each is shown neutralized and
// capped. A list name is at most 64 bytes on chain; the other fields are
// addresses and block or list numbers.
export const DIRECTORY_NAME_MAX_CHARS = 64;
export const DIRECTORY_FIELD_MAX_CHARS = 100;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function directoryText(value) {
    return neutralizeControlText(value, { maxLength: DIRECTORY_FIELD_MAX_CHARS });
}

export function orderSharedLists(entries) {
    return [...entries].sort((left, right) => {
        const platformOrder = Number(right.maintainedByPlatform === true)
            - Number(left.maintainedByPlatform === true);
        if (platformOrder !== 0) return platformOrder;

        const chainOrder = String(left.homeChain).localeCompare(String(right.homeChain));
        if (chainOrder !== 0) return chainOrder;

        return Number(left.homeListIndex) - Number(right.homeListIndex);
    });
}

export function pickableSharedLists(entries, filterType) {
    return orderSharedLists(entries).filter((entry) => (
        entry.type === filterType && validActionIndex(entry.bindTarget)
    ));
}

export function shortOwner(owner) {
    if (typeof owner !== 'string') return '';
    const text = neutralizeControlText(owner);
    if (text.length <= 14) return text;
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

export function platformBadgeText(entry) {
    return entry.maintainedByPlatform === true ? 'Maintained by XChain Platform' : null;
}

export function bindLabel(entry) {
    return entry.bindTarget == null ? 'not yet mirrored here' : directoryText(entry.bindTarget);
}
