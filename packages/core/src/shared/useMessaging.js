// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useContext } from 'react';
import { MessagingContext } from './MessagingContext.js';

/**
 * Access the shell's messaging module + shell identifier.
 *
 * Throws when used outside `<MessagingProvider>` — surfaces routing
 * mistakes immediately rather than silently returning null and letting
 * a downstream call fail with "cannot read properties of null".
 *
 * @returns {import('./MessagingContext.js').MessagingContextValue}
 */
export function useMessaging() {
    const value = useContext(MessagingContext);
    if (!value) {
        throw new Error('useMessaging must be used inside <MessagingProvider>.');
    }
    return value;
}

/**
 * Resolve the Screen layout variant from the current shell.
 *
 * Layout variant follows AVAILABLE WIDTH, not container type:
 *   `small` — narrow viewport (Chrome extension popup, mobile browser,
 *             narrow desktop window, future native app with limited
 *             width). The legacy `popup` literal is also accepted as
 *             an alias by every consumer.
 *   `full`  — wide viewport (desktop browser, tablet landscape,
 *             extension full-screen mode).
 *
 * The shell-based mapping here is the conservative default for
 * shells that don't pass their own width signal through; the web
 * shell overrides this at boot via `useActiveVariant` so it picks
 * the right variant by viewport width.
 *
 * @param {'popup' | 'web' | 'desktop'} shell
 * @returns {'small' | 'full'}
 */
export function screenVariantFor(shell) {
    return shell === 'popup' ? 'small' : 'full';
}
