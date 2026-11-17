// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createContext } from 'react';

/**
 * The navigation surface the unlocked layout has on screen: 'sidebar' (the
 * labelled sidebar or the icon rail), 'tabBar' (the compact bottom bar), or
 * null when neither renders. FullLayoutWithNav provides it from its measured
 * tier, so a 360px popup inside a wide window reads as 'tabBar'.
 */
export const NavSurfaceContext = createContext(
    /** @type {'sidebar' | 'tabBar' | null} */ (null),
);

/** The routed view id (the shell's unlockedView), provided by ShellRouteOutlet. */
export const CurrentRouteContext = createContext(/** @type {string | null} */ (null));
// Back visibility no longer reads the nav surface: PageHeader follows the
// shell history through NavHistoryContext (navHistory.js, G06).
