// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Whether the user's last input was a key press. Chrome draws its focus box
// on an element that script focuses before the user has pressed or clicked
// anything, so a screen heading focused on first load shows a box nobody
// asked for; callers use this to draw that box only for keyboard users.

let keyboard = false;
let installed = false;

function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.addEventListener('keydown', (event) => {
        if (!event.metaKey && !event.altKey && !event.ctrlKey) keyboard = true;
    }, true);
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
        document.addEventListener(type, () => { keyboard = false; }, true);
    }
}

install();

/** @returns {boolean} true when a key press came after the last pointer press */
export function lastInputWasKeyboard() {
    install();
    return keyboard;
}
