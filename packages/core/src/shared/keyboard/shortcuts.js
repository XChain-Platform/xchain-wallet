// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §34 keyboard-shortcut catalogue. ONE source of truth, consumed by both the
// dispatcher (useKeyboardShortcuts) and the help modal (ShortcutHelp), so the
// two can never disagree about what a shortcut does. Rebinding (§34.1) is a
// later item ; for now these are the fixed defaults.
//
// A binding string is either:
//   'mod+k'   a modifier combo: `mod` = Cmd on macOS / Ctrl elsewhere, then a
//             single key. Combos fire regardless of focus (they're
//             unambiguous), except the browser-owned ones we deliberately skip.
//   '?'       a single key: only fires when no editable element has focus.
//   'g h'     a leader sequence: press `g`, then the next key. Editable-gated
//             like single keys.
//
// `action` is a small opcode the dispatcher maps onto the shell's handlers;
// keeping actions as data (not closures) is what lets this table be static and
// the help modal render it without holding live callbacks.

export const SHORTCUTS = /** @type {const} */ ([
    // General
    { id: 'command-palette', binding: 'mod+k', label: 'Open command palette', action: 'palette', group: 'General', dispatch: false },
    { id: 'shortcut-help', binding: '?', altBinding: 'mod+/', label: 'Keyboard shortcuts', action: 'help', group: 'General', dispatch: true },
    { id: 'lock', binding: 'mod+l', label: 'Lock wallet', action: 'lock', group: 'General', dispatch: true },
    { id: 'settings', binding: 'mod+,', label: 'Open settings', action: 'nav:settings', group: 'General', dispatch: true },
    { id: 'new-send', binding: 'mod+n', label: 'New send', action: 'nav:send', group: 'General', dispatch: true },
    // Go to (g-leader)
    { id: 'go-balances', binding: 'g b', label: 'Go to Balances', action: 'nav:home', group: 'Go to', dispatch: true },
    { id: 'go-history', binding: 'g h', label: 'Go to History', action: 'nav:history', group: 'Go to', dispatch: true },
    { id: 'go-send', binding: 'g s', label: 'Go to Send', action: 'nav:send', group: 'Go to', dispatch: true },
    { id: 'go-receive', binding: 'g r', label: 'Go to Receive', action: 'nav:receive', group: 'Go to', dispatch: true },
    { id: 'go-dex', binding: 'g d', label: 'Go to DEX', action: 'nav:markets', group: 'Go to', dispatch: true },
    { id: 'go-contacts', binding: 'g c', label: 'Go to Contacts', action: 'nav:contacts', group: 'Go to', dispatch: true },
]);

// Groups in render order for the help modal.
export const SHORTCUT_GROUPS = /** @type {const} */ (['General', 'Go to']);

/**
 * True when the element should swallow single-key / leader shortcuts (the user
 * is typing). Modifier combos are allowed to fire even here.
 *
 * @param {EventTarget | null} el
 * @returns {boolean}
 */
export function isEditableTarget(el) {
    if (!el || typeof el !== 'object') return false;
    const node = /** @type {HTMLElement} */ (el);
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return node.isContentEditable === true;
}

/**
 * Classify a binding string.
 * @param {string} binding
 * @returns {{ kind: 'combo', key: string } | { kind: 'single', key: string } | { kind: 'leader', lead: string, key: string }}
 */
export function parseBinding(binding) {
    if (binding.startsWith('mod+')) return { kind: 'combo', key: binding.slice(4).toLowerCase() };
    if (binding.includes(' ')) {
        const [lead, key] = binding.split(/\s+/);
        return { kind: 'leader', lead: lead.toLowerCase(), key: key.toLowerCase() };
    }
    return { kind: 'single', key: binding };
}

/**
 * Human-readable rendering of a binding for the help modal. `mac` picks ⌘/⌥
 * glyphs vs "Ctrl".
 * @param {string} binding
 * @param {boolean} [mac]
 * @returns {string}
 */
export function formatBinding(binding, mac = false) {
    const parsed = parseBinding(binding);
    if (parsed.kind === 'combo') {
        const mod = mac ? '⌘' : 'Ctrl';
        const key = parsed.key === ',' ? ',' : parsed.key.toUpperCase();
        return mac ? `${mod}${key}` : `${mod}+${key}`;
    }
    if (parsed.kind === 'leader') return `${parsed.lead.toUpperCase()} then ${parsed.key.toUpperCase()}`;
    return parsed.key; // single key like '?'
}
