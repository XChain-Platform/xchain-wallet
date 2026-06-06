// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// usePrivacyBlur — §26 / G069. Sets `data-xc-privacy-blur="true"` on the
// document root whenever the host window loses focus AND the user has
// turned the feature on in Settings → Privacy. CSS in tokens.css picks
// up the attribute and applies the actual blur, so the hook itself only
// owns the focus tracking.
//
// Blur triggers:
//   - window 'blur' event           (alt-tab, click-away, focus loss)
//   - 'visibilitychange' to hidden  (popup occluded, tab backgrounded)
//
// Unblur triggers:
//   - window 'focus' event
//   - 'visibilitychange' to visible
//
// When `enabled` flips false the attribute is removed and listeners
// detach so the page renders crisply regardless of focus state.

import { useEffect, useState } from 'react';

const ATTR = 'xcPrivacyBlur';   // data-xc-privacy-blur after camelCase→kebab
const TRUE = 'true';

function isHostHidden() {
    if (typeof document === 'undefined') return false;
    if (document.visibilityState === 'hidden') return true;
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return true;
    return false;
}

function applyAttr(on) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (!root) return;
    if (on) {
        root.dataset[ATTR] = TRUE;
    } else {
        delete root.dataset[ATTR];
    }
}

/**
 * @param {boolean} enabled  read from settings.privacy.blurOnBlur
 * @returns {boolean} `true` while the window is blurred AND enabled
 */
export function usePrivacyBlur(enabled) {
    const [isBlurred, setIsBlurred] = useState(false);

    useEffect(() => {
        if (!enabled) {
            applyAttr(false);
            setIsBlurred(false);
            return undefined;
        }
        if (typeof window === 'undefined') return undefined;

        const sync = () => {
            const hidden = isHostHidden();
            applyAttr(hidden);
            setIsBlurred(hidden);
        };

        // Seed initial state in case the hook mounts while already blurred.
        sync();

        window.addEventListener('blur', sync);
        window.addEventListener('focus', sync);
        document.addEventListener('visibilitychange', sync);

        return () => {
            window.removeEventListener('blur', sync);
            window.removeEventListener('focus', sync);
            document.removeEventListener('visibilitychange', sync);
            applyAttr(false);
        };
    }, [enabled]);

    return isBlurred;
}
