// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The lists a wallet picked lately in the list picker, newest first, per
// wallet and network. A pick carries only public chain data (a list's index,
// type, name, member count and, for a published list, its home), and the
// store is a convenience: an unreadable or full storage leaves it empty.

import { validActionIndex } from './sharedBlockPick.js';

export const LIST_PICKER_RECENTS_MAX = 10;

const KEY_PREFIX = 'xc.listPicker.recent.v1';

function storage() {
    try { return globalThis.localStorage || null; } catch { return null; }
}

/**
 * @param {string} walletId
 * @param {string} chainId
 */
export function listPickerRecentsKey(walletId, chainId) {
    return `${KEY_PREFIX}:${walletId}:${chainId}`;
}

function cleanEntry(entry) {
    if (entry === null || typeof entry !== 'object' || !validActionIndex(entry.actionIndex)) return null;
    const out = {
        actionIndex: String(entry.actionIndex),
        type: entry.type == null ? '' : String(entry.type),
        memberCount: typeof entry.memberCount === 'number' && Number.isFinite(entry.memberCount)
            ? entry.memberCount
            : null,
    };
    if (typeof entry.name === 'string' && entry.name.length > 0) out.name = entry.name;
    if (entry.homeChain != null && entry.homeListIndex != null) {
        out.homeChain = String(entry.homeChain);
        out.homeListIndex = String(entry.homeListIndex);
    }
    return out;
}

/**
 * The recent picks for one wallet on one network, newest first.
 *
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} chainId
 * @returns {Array<{ actionIndex: string, type: string, memberCount: number | null, name?: string, homeChain?: string, homeListIndex?: string }>}
 */
export function readListPickerRecents(walletId, chainId) {
    if (!walletId || !chainId) return [];
    try {
        const raw = storage()?.getItem(listPickerRecentsKey(walletId, chainId));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map(cleanEntry).filter(Boolean) : [];
    } catch {
        return [];
    }
}

/**
 * Records a pick at the front of the recents, dropping an older pick of the
 * same list and anything past the cap.
 *
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} chainId
 * @param {object} pick   the picker's onSelect payload
 */
export function recordListPickerRecent(walletId, chainId, pick) {
    const entry = cleanEntry(pick);
    if (!walletId || !chainId || !entry) return;
    const next = [entry, ...readListPickerRecents(walletId, chainId)
        .filter((row) => row.actionIndex !== entry.actionIndex)]
        .slice(0, LIST_PICKER_RECENTS_MAX);
    try {
        storage()?.setItem(listPickerRecentsKey(walletId, chainId), JSON.stringify(next));
    } catch {
        // A full or blocked storage only loses the recents.
    }
}
