// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §33.1 / §34.1: the global Cmd/Ctrl+K binding that opens the command
// palette. A tiny hook so any shell can adopt the palette by rendering
// <CommandPalette> and spreading this hook's open state. Kept separate from
// the component so the component stays a pure, prop-driven modal.
//
// `enabled` gates the listener: shells pass `false` while the wallet is
// locked or onboarding, so Cmd/Ctrl+K is inert until there's an unlocked
// surface to navigate. The palette itself owns Esc; this hook only handles
// the open toggle and leaves every focused editable field alone.

import { useCallback, useEffect, useState } from 'react';
import { canHandleGlobalShortcut } from '../keyboard/useKeyboardShortcuts.js';

/**
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]  install the global shortcut listener
 * @param {string} [opts.binding='mod+k']  §34.1: the (rebindable) combo that
 *        toggles the palette; only 'mod+<key>' shapes are honored.
 * @param {(view: string) => void} [opts.navigate]  shell route setter
 * @param {string} [opts.currentView]  the view the shell shows now; when it
 *        changes the palette closes
 * @returns {{ open: boolean, openPalette: () => void, closePalette: () => void, togglePalette: () => void, navigate: (view: string) => void, navigationKey: number }}
 */
export function useCommandPalette(opts = {}) {
    const { enabled = true, binding = 'mod+k', navigate: setRoute, currentView } = opts;
    const comboKey = binding.startsWith('mod+') ? binding.slice(4).toLowerCase() : 'k';
    const [open, setOpen] = useState(false);
    const [navigationKey, setNavigationKey] = useState(0);

    const openPalette = useCallback(() => setOpen(true), []);
    const closePalette = useCallback(() => setOpen(false), []);
    const togglePalette = useCallback(() => setOpen((v) => !v), []);
    // Give every palette selection a fresh route mount, including when the
    // selected action is already showing a completed form.
    const navigate = useCallback((view) => {
        setNavigationKey((key) => key + 1);
        setRoute?.(view);
    }, [setRoute]);

    // Force-close whenever the shortcut is disabled (lock / onboarding), so
    // a palette left open when the wallet locks can't linger over the
    // Locked screen.
    useEffect(() => {
        if (!enabled) setOpen(false);
    }, [enabled]);

    // The palette covers the content but not the navigation, so the bottom
    // bar and the More sheet stay live under it. Any navigation closes it;
    // otherwise it stayed open over the screen the user moved to, with the
    // More sheet stacked on top (iPhone, 2026-10-12).
    useEffect(() => {
        setOpen(false);
    }, [currentView]);

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') return undefined;
        const onKey = (e) => {
            if (!canHandleGlobalShortcut(e)) return;
            // Cmd+key (mac) / Ctrl+key (win/linux).
            if ((e.key || '').toLowerCase() === comboKey
                && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                setOpen((v) => !v);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [enabled, comboKey]);

    return { open, openPalette, closePalette, togglePalette, navigate, navigationKey };
}
