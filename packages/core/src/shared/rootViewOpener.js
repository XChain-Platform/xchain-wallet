// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One root-navigation helper for every shell. A page opened from the sidebar,
// bottom bar, menu, palette or a go-to shortcut is a root, and a root page
// opens its form free-entry: the token a Manage token or token page form
// handed over (formSource, tokenAdminInitialPicker) must not follow into an
// unrelated form such as Issue token. Back restores the prefill through the
// history entry, not through this state.

/**
 * @param {(view: string) => void} navigateRoot  the shell's history-resetting route setter
 * @param {() => void} clearSource  clears the form-source state; read at call time, so it may close over state declared later in the shell
 * @returns {(view: string) => void}
 */
export function createRootViewOpener(navigateRoot, clearSource) {
    return (view) => {
        clearSource();
        navigateRoot(view);
    };
}
