// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.


// The in-field Paste shared by the address fields (Send's recipient
// combobox and AddressField): the clipboard check that runs before a pasted
// address reaches the field, and the measure that keeps the field's text and
// icon clear of the Paste button.

/**
 * Trims whitespace and zero-width characters from both ends of pasted text,
 * and refuses text that still carries hidden or direction-changing
 * characters, which can make one address look like another.
 *
 * @param {unknown} value
 * @returns {{ ok: boolean, value: string, error: string | null }}
 */
export function inspectClipboardPaste(value) {
    const edges = /^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g;
    const hiddenCharacters = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;
    const normalized = String(value ?? '').replace(edges, '');
    const hidden = hiddenCharacters.test(normalized);
    return hidden
        ? {
            ok: false,
            value: normalized,
            error: 'Pasted text contains hidden characters. Check it and try again.',
        }
        : { ok: true, value: normalized, error: null };
}

/**
 * Keeps `--address-paste-width` on the field equal to the room the in-field
 * Paste button really takes: its width plus its end inset on both sides,
 * rounded up. The stylesheet's value is the default-text estimate; Paste
 * grows with the text size (and with a longer translated label), and the
 * icon action and the input's text both lay out against this width, so an
 * estimate alone let the icon run into Paste at large text.
 *
 * @param {HTMLElement | null} wrap   the field's wrapper, which owns the property
 * @param {HTMLElement | null} paste  the Paste button
 * @returns {number | null} the width written, or null when nothing was measured
 */
export function syncPasteWidth(wrap, paste) {
    if (!wrap || !paste) return null;
    const width = paste.getBoundingClientRect().width;
    if (!(width > 0)) return null;
    const inset = Number.parseFloat(getComputedStyle(paste).insetInlineEnd);
    const room = Math.ceil(width) + 2 * (Number.isFinite(inset) ? inset : 0);
    wrap.style.setProperty('--address-paste-width', `${room}px`);
    return room;
}
