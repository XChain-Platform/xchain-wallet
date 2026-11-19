// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Allow list and Block list fields on the Edit Order and Edit Swap
// panels (ListField). A picked index replaces the bound list, '0' removes it,
// and '' leaves it as it is.

/**
 * The field's text: "None after this update" once the bound list is removed,
 * the picked list, the list bound now, or null so the field shows its placeholder.
 *
 * @param {string} pickedIdx  '' (unchanged), '0' (remove) or a list's action index
 * @param {string | null} currentIdx  the list bound to the order or swap now
 * @param {string} noun  'Allow list' or 'Block list'
 * @returns {string | null}
 */
export function editListText(pickedIdx, currentIdx, noun) {
    if (pickedIdx === '0') return 'None after this update';
    if (pickedIdx) return `${noun} #${pickedIdx}`;
    return currentIdx ? `${noun} #${currentIdx}` : null;
}

/**
 * The field's clear action: a fresh pick goes back to the bound list, and a
 * bound list is removed ('0') where the network allows removing it.
 *
 * @param {string} pickedIdx
 * @param {string | null} currentIdx
 * @param {boolean} canRemove  list removal is active on this network
 * @param {(idx: string) => void} setIdx
 * @returns {(() => void) | undefined}
 */
export function editListClear(pickedIdx, currentIdx, canRemove, setIdx) {
    if (pickedIdx && pickedIdx !== '0') return () => setIdx('');
    if (!pickedIdx && currentIdx && canRemove) return () => setIdx('0');
    return undefined;
}
