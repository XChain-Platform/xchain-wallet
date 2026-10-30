// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §34 keyboard-shortcut catalogue. ONE source of truth, consumed by the
// dispatcher (useKeyboardShortcuts), the help modal (ShortcutHelp), and the
// Settings → Keyboard rebinding UI, so the three can never disagree about
// what a shortcut does. §34.1 rebinding: the table holds the DEFAULTS;
// per-user overrides live in settings.keyboard.bindings ({ id -> binding })
// and are applied via resolveBindings below.
//
// A binding string is either:
//   'mod+k'   a modifier combo: `mod` = Cmd on macOS / Ctrl elsewhere, then a
//             single key. Global combos stay inactive while the user types in
//             an editable field.
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
    // The browser keeps Cmd/Ctrl+L, +N and +comma in a web tab, so these three
    // defaults are keys the page receives. `family: 'combo'` keeps Settings →
    // Keyboard recording a Cmd/Ctrl combo when a user rebinds one.
    { id: 'lock', binding: 'g l', label: 'Lock wallet', action: 'lock', group: 'General', dispatch: true, family: 'combo' },
    { id: 'settings', binding: 'g e', label: 'Open settings', action: 'nav:settings', group: 'General', dispatch: true, family: 'combo' },
    { id: 'new-send', binding: 'g n', label: 'New send', action: 'nav:send', group: 'General', dispatch: true, family: 'combo' },
    // Go to (g-leader)
    { id: 'go-balances', binding: 'g b', label: 'Go to balances', action: 'nav:home', group: 'Go to', dispatch: true },
    { id: 'go-history', binding: 'g h', label: 'Go to history', action: 'nav:history', group: 'Go to', dispatch: true },
    { id: 'go-send', binding: 'g s', label: 'Go to send', action: 'nav:send', group: 'Go to', dispatch: true },
    { id: 'go-receive', binding: 'g r', label: 'Go to receive', action: 'nav:receive', group: 'Go to', dispatch: true },
    { id: 'go-dex', binding: 'g d', label: 'Go to DEX', action: 'nav:markets', group: 'Go to', dispatch: true },
    { id: 'go-contacts', binding: 'g c', label: 'Go to contacts', action: 'nav:contacts', group: 'Go to', dispatch: true },
    // §34.2 context-sensitive shortcuts. dispatch: false - each lives in its
    // route component (via useScreenShortcuts), listed here so the help modal
    // and rebinding UI stay the single catalogue. `rebindable: false`: the
    // route hooks read the fixed defaults (per-screen override plumbing isn't
    // worth its settings surface yet).
    { id: 'history-filter', binding: '/', label: 'Filter history', action: 'ctx:history-filter', group: 'History', dispatch: false, rebindable: false },
    { id: 'history-export', binding: 'e', label: 'Export history', action: 'ctx:history-export', group: 'History', dispatch: false, rebindable: false },
    { id: 'balances-pin', binding: 'p', label: 'Pin focused token', action: 'ctx:balances-pin', group: 'Balances', dispatch: false, rebindable: false },
    { id: 'balances-hide', binding: 'h', label: 'Hide focused token', action: 'ctx:balances-hide', group: 'Balances', dispatch: false, rebindable: false },
    { id: 'balances-open', binding: 'o', label: 'Open focused token', action: 'ctx:balances-open', group: 'Balances', dispatch: false, rebindable: false },
    { id: 'send-submit', binding: 'mod+enter', label: 'Submit the send form', action: 'ctx:send-submit', group: 'Send', dispatch: false, rebindable: false },
]);

// Groups in render order for the help modal.
export const SHORTCUT_GROUPS = /** @type {const} */ (['General', 'Go to', 'Balances', 'History', 'Send']);

// ---- §34.1 rebinding ------------------------------------------------------

// Select-all and the clipboard combos stay the platform's own. A wallet
// shortcut on one of them takes the keypress on every non-editable target, so
// copying an address from a page (or pasting, which users do with the native
// shortcut) would lock the wallet or navigate instead.
const RESERVED_COMBO_KEYS = new Set(['a', 'c', 'v', 'x']);

// Browser and desktop chords never reach a page in a normal tab: close tab or
// window (W), new tab (T), new window (N), quit (Q), reload (R), address bar
// (L) and the browser or app settings (comma). Cmd+Shift+T, Cmd+Shift+N and
// F5 are outside the binding grammar, and the capture refuses them by name.
const BROWSER_RESERVED_KEYS = new Set(['w', 't', 'n', 'q', 'r', 'l', ',']);
const BROWSER_RESERVED_SHIFTED_KEYS = new Set(['t', 'n']);

/**
 * Name the browser- or desktop-reserved chord a keydown spells, or null. The
 * Settings → Keyboard capture refuses these with an "already used" message
 * instead of recording a binding that never fires.
 *
 * @param {{ key?: string, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean }} e
 * @param {boolean} [mac]
 * @returns {string | null}
 */
export function reservedChordLabel(e, mac = false) {
    const key = String(e.key || '').toLowerCase();
    if (key === 'f5') return 'F5';
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
    const keys = e.shiftKey ? BROWSER_RESERVED_SHIFTED_KEYS : BROWSER_RESERVED_KEYS;
    if (!keys.has(key)) return null;
    return formatBinding(`mod+${key}`, mac).replace('+', e.shiftKey ? '+Shift+' : '+');
}

/**
 * The binding family a rebind keeps. An entry names its family when its
 * default sits in a different one from the chords users may record for it.
 * @param {{ binding: string, family?: string }} s
 * @returns {'combo' | 'single' | 'leader'}
 */
export function bindingFamily(s) {
    return /** @type {any} */ (s.family) || parseBinding(s.binding).kind;
}

/**
 * True for entries the Settings → Keyboard UI may rebind: the globally
 * dispatched set plus the palette combo (whose listener lives in
 * useCommandPalette). Context shortcuts stay fixed for now.
 * @param {{ dispatch?: boolean, rebindable?: boolean, id: string }} s
 */
export function isRebindable(s) {
    if (s.rebindable === false) return false;
    return s.dispatch === true || s.id === 'command-palette';
}

/**
 * Validate a user-supplied binding string against the grammar parseBinding
 * understands. `kind` restricts the accepted shapes: rebinding keeps each
 * shortcut in its original family (a combo stays a combo) so the dispatcher's
 * focus rules keep making sense for it.
 *
 * @param {string} binding
 * @param {'combo' | 'single' | 'leader'} [kind]
 * @returns {boolean}
 */
export function isValidBinding(binding, kind) {
    if (typeof binding !== 'string' || !binding) return false;
    if (binding.startsWith('mod+')) {
        const key = binding.slice(4);
        // One printable key, or a named key like Enter. Never bare 'mod+'.
        if (!/^[a-z0-9,./;'[\]\\`=-]$/.test(key) && !/^(enter|escape|backspace|tab|space)$/.test(key)) return false;
        if (RESERVED_COMBO_KEYS.has(key) || BROWSER_RESERVED_KEYS.has(key)) return false;
        return !kind || kind === 'combo';
    }
    if (/^[a-z0-9] [a-z0-9]$/.test(binding)) return !kind || kind === 'leader';
    if (/^[a-z0-9?/.,]$/.test(binding)) return !kind || kind === 'single';
    return false;
}

/**
 * Apply per-user overrides to the catalogue. Returns a new array with the
 * same entries, each with an `effective` binding (override when present and
 * valid, else the default) and `overridden` flag. altBinding is dropped when
 * an override applies (the override IS the binding).
 *
 * @param {Record<string, string> | null | undefined} overrides  settings.keyboard.bindings
 * @returns {Array<(typeof SHORTCUTS)[number] & { binding: string, altBinding?: string, overridden: boolean }>}
 */
export function resolveBindings(overrides) {
    const map = overrides && typeof overrides === 'object' ? overrides : {};
    return SHORTCUTS.map((s) => {
        const o = map[s.id];
        if (isRebindable(s) && typeof o === 'string' && o !== s.binding
            && isValidBinding(o, bindingFamily(s))) {
            return { ...s, binding: o, altBinding: undefined, overridden: true };
        }
        return { ...s, overridden: false };
    });
}

/**
 * True when two bindings claim the same keypress. Besides an exact match, a
 * single key collides with a leader sequence that starts on it: the dispatcher
 * arms the leader on that key, so the single-key shortcut would never fire,
 * and a screen's single key (History 'e', Balances 'h') would fire alongside
 * the armed leader.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function bindingsCollide(a, b) {
    if (a === b) return true;
    const pa = parseBinding(a);
    const pb = parseBinding(b);
    if (pa.kind === 'leader' && pb.kind === 'single') return pa.lead === pb.key.toLowerCase();
    if (pa.kind === 'single' && pb.kind === 'leader') return pb.lead === pa.key.toLowerCase();
    return false;
}

/**
 * Find the id of another shortcut whose effective binding collides with
 * `binding`, or null. Used by the rebinding UI to refuse conflicts.
 *
 * @param {string} id        the shortcut being rebound
 * @param {string} binding   the candidate binding
 * @param {Record<string, string> | null | undefined} overrides
 * @returns {string | null}
 */
export function findBindingConflict(id, binding, overrides) {
    for (const s of resolveBindings(overrides)) {
        if (s.id === id) continue;
        if ([s.binding, s.altBinding].some((other) => other && bindingsCollide(other, binding))) return s.id;
    }
    return null;
}

// Input types that take no typed text. Focus lands on a radio or a checkbox
// after a click, and treating those as typing left Cmd/Ctrl+K dead until the
// user clicked somewhere else (the Wallet mode radios, 2026-10-14).
const NON_TEXT_INPUT_TYPES = new Set([
    'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);

/**
 * True when the element should swallow global shortcuts because the user is
 * typing. Every binding family stays inactive here.
 *
 * @param {EventTarget | null} el
 * @returns {boolean}
 */
export function isEditableTarget(el) {
    if (!el || typeof el !== 'object') return false;
    const node = /** @type {HTMLElement} */ (el);
    const tag = node.tagName;
    if (tag === 'INPUT') {
        const type = String(/** @type {HTMLInputElement} */ (node).type || 'text').toLowerCase();
        return !NON_TEXT_INPUT_TYPES.has(type);
    }
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
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
 * Human-readable rendering of a binding for the help modal. `mac` selects
 * the platform modifier name.
 * @param {string} binding
 * @param {boolean} [mac]
 * @returns {string}
 */
export function formatBinding(binding, mac = false) {
    const parsed = parseBinding(binding);
    if (parsed.kind === 'combo') {
        const mod = mac ? 'Cmd' : 'Ctrl';
        // Single chars render uppercase ('K'); named keys ('enter') render
        // capitalized ('Enter') so Ctrl+Enter doesn't shout.
        const key = parsed.key.length === 1
            ? (parsed.key === ',' ? ',' : parsed.key.toUpperCase())
            : parsed.key[0].toUpperCase() + parsed.key.slice(1);
        return `${mod}+${key}`;
    }
    if (parsed.kind === 'leader') return `${parsed.lead.toUpperCase()} then ${parsed.key.toUpperCase()}`;
    return parsed.key; // single key like '?'
}
