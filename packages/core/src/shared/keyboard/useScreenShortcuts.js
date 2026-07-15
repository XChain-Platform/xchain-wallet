// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §34.2 context-sensitive shortcuts. A route component mounts this with the
// keys that apply on its screen (History: '/' filter + 'e' export; Send:
// 'mod+enter' submit; Balances: 'p'/'h'/'o' on the focused row). The catalogue
// entries for these live in shortcuts.js with dispatch: false, so the help
// modal lists them while dispatch stays local to the screen.
//
// Focus rules mirror useKeyboardShortcuts: single keys are suppressed while an
// editable element has focus; 'mod+...' combos fire anywhere (that's the point
// of Cmd/Ctrl+Enter inside a form). Handlers may return false to decline the
// key (e.g. no row focused), letting the event proceed untouched.

import { useEffect, useRef } from 'react';
import { isEditableTarget } from './shortcuts.js';

/**
 * @param {object} opts
 * @param {boolean} [opts.enabled=true]
 * @param {Record<string, (e: KeyboardEvent) => (void | boolean)>} opts.keys
 *        binding string ('/'; 'e'; 'mod+enter') -> handler
 */
export function useScreenShortcuts({ enabled = true, keys }) {
    const keysRef = useRef(keys);
    keysRef.current = keys;

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') return undefined;
        const onKey = (e) => {
            const map = keysRef.current || {};
            const mod = e.metaKey || e.ctrlKey;
            if (mod && !e.altKey && !e.shiftKey) {
                const handler = map[`mod+${(e.key || '').toLowerCase()}`];
                if (handler && handler(e) !== false) e.preventDefault();
                return;
            }
            if (mod || e.altKey) return;
            if (isEditableTarget(e.target)) return;
            const handler = map[e.key] || map[(e.key || '').toLowerCase()];
            if (handler && handler(e) !== false) e.preventDefault();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [enabled]);
}
