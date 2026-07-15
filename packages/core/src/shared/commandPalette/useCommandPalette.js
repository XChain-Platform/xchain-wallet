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
// the open toggle so it can live at the app root without stealing keys from
// focused inputs (Cmd/Ctrl+K is not something a text field wants).

import { useCallback, useEffect, useState } from 'react';

/**
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]  install the global shortcut listener
 * @returns {{ open: boolean, openPalette: () => void, closePalette: () => void, togglePalette: () => void }}
 */
export function useCommandPalette(opts = {}) {
    const { enabled = true } = opts;
    const [open, setOpen] = useState(false);

    const openPalette = useCallback(() => setOpen(true), []);
    const closePalette = useCallback(() => setOpen(false), []);
    const togglePalette = useCallback(() => setOpen((v) => !v), []);

    // Force-close whenever the shortcut is disabled (lock / onboarding), so
    // a palette left open when the wallet locks can't linger over the
    // Locked screen.
    useEffect(() => {
        if (!enabled) setOpen(false);
    }, [enabled]);

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') return undefined;
        const onKey = (e) => {
            // Cmd+K (mac) / Ctrl+K (win/linux). metaKey guards against
            // Ctrl+K in a browser that maps it elsewhere; we accept either
            // modifier so both platforms get the same binding.
            const k = e.key === 'K' || e.key === 'k';
            if (k && (e.metaKey || e.ctrlKey) && !e.altKey) {
                e.preventDefault();
                setOpen((v) => !v);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [enabled]);

    return { open, openPalette, closePalette, togglePalette };
}
