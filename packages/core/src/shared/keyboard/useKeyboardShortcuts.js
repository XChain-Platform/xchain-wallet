// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §34 keyboard-shortcut dispatcher. Installs one window keydown listener that
// maps the SHORTCUTS table onto shell handlers. Cmd/Ctrl+K is NOT handled here
// (useCommandPalette owns it); this covers the rest of the core set plus the
// `g`-leader navigation.
//
// Focus rules (§34.4 / the "when no input has focus" caveat):
//   - Modifier combos (Cmd/Ctrl+L, +N, +,, +/) fire regardless of focus.
//   - Single keys ('?') and leader sequences ('g h') are suppressed while an
//     editable element (input/textarea/select/contenteditable) has focus, so
//     typing a memo or a search query never triggers navigation.
//
// `enabled` gates the whole listener: shells pass false while locked, while the
// command palette is open (its own input owns the keys), and while the shortcut
// help modal is open (so nav keys can't fire behind it).

import { useEffect, useMemo, useRef } from 'react';
import { isEditableTarget, parseBinding, resolveBindings } from './shortcuts.js';

// How long a leader key stays armed waiting for the second key.
const LEADER_WINDOW_MS = 1200;

/**
 * Build the dispatcher's lookup maps from the effective (default +
 * user-override) bindings. Leader sequences map lead-key -> (second-key ->
 * action) so a rebind like 'g h' -> 't h' works without hardcoding 'g'.
 *
 * @param {Record<string, string> | null | undefined} overrides
 */
function buildLookups(overrides) {
    const combo = new Map();   // key -> action
    const single = new Map();  // key -> action
    const leader = new Map();  // lead-key -> Map(second-key -> action)
    for (const s of resolveBindings(overrides)) {
        if (!s.dispatch) continue;
        for (const binding of [s.binding, s.altBinding].filter(Boolean)) {
            const p = parseBinding(binding);
            if (p.kind === 'combo') combo.set(p.key, s.action);
            else if (p.kind === 'single') single.set(p.key, s.action);
            else {
                if (!leader.has(p.lead)) leader.set(p.lead, new Map());
                leader.get(p.lead).set(p.key, s.action);
            }
        }
    }
    return { combo, single, leader };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.enabled=true]
 * @param {Record<string, string>} [opts.overrides]  settings.keyboard.bindings (§34.1)
 * @param {object} opts.handlers
 * @param {(view: string) => void} opts.handlers.navigate
 * @param {() => void} [opts.handlers.lock]
 * @param {() => void} [opts.handlers.openHelp]
 */
export function useKeyboardShortcuts({ enabled = true, overrides, handlers }) {
    const lookups = useMemo(() => buildLookups(overrides), [overrides]);
    // Keep the latest handlers in a ref so the listener effect doesn't need to
    // re-bind (and lose leader state) every time the shell re-renders new
    // closures.
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;
    const leaderRef = useRef(/** @type {{ armed: string | null, timer: any }} */ ({ armed: null, timer: null }));

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') return undefined;
        const { combo: COMBO, single: SINGLE, leader: LEADER } = lookups;
        const leader = leaderRef.current;

        const clearLeader = () => {
            leader.armed = null;
            if (leader.timer) { clearTimeout(leader.timer); leader.timer = null; }
        };

        const run = (action) => {
            const h = handlersRef.current || {};
            if (action === 'help') { h.openHelp?.(); return; }
            if (action === 'lock') { h.lock?.(); return; }
            if (action.startsWith('nav:')) { h.navigate?.(action.slice(4)); return; }
        };

        const onKey = (e) => {
            const mod = e.metaKey || e.ctrlKey;

            // Modifier combos fire anywhere. Never swallow Alt/Shift-modified
            // combos (none of ours use them) so we don't hijack OS chords.
            if (mod && !e.altKey && !e.shiftKey) {
                const action = COMBO.get((e.key || '').toLowerCase());
                if (action) { e.preventDefault(); run(action); }
                return;
            }
            if (mod) return; // some other modifier chord; not ours

            // From here down: no modifier. Suppress while typing.
            if (isEditableTarget(e.target)) { clearLeader(); return; }

            const key = (e.key || '').toLowerCase();

            // Second key of an armed leader sequence.
            if (leader.armed) {
                const action = LEADER.get(leader.armed)?.get(key);
                clearLeader();
                if (action) { e.preventDefault(); run(action); return; }
                // A non-matching key just cancels the sequence; fall through so
                // it can still trigger a single-key shortcut.
            }

            // Arm a leader sequence when the key is a known lead ('g' by
            // default; rebinding could introduce another).
            if (LEADER.has(key)) {
                leader.armed = key;
                if (leader.timer) clearTimeout(leader.timer);
                leader.timer = setTimeout(clearLeader, LEADER_WINDOW_MS);
                return;
            }

            // Single-key shortcuts match on the exact (un-lowercased) key so
            // '?' stays '?'.
            const single = SINGLE.get(e.key);
            if (single) { e.preventDefault(); run(single); }
        };

        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            clearLeader();
        };
    }, [enabled, lookups]);
}
