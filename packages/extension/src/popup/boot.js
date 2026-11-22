// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The only module script of popup.html and sidepanel.html. Chrome shows the
// toolbar popup once the page's first load finishes, and a module script in
// the page holds that load until it and every module it imports statically
// have run: with main.jsx as the page script, the popup stayed hidden for as
// long as the whole wallet took to compile, which on a busy machine left the
// toolbar icon highlighted with nothing on screen (operator 2026-11-21).
//
// A dynamic import does not hold the load, so the popup opens at its fixed
// size (popup-size.js) with the boot screen's logo and progress bar while the
// wallet loads behind it. A failed import rejects unhandled, which
// popup-size.js turns into the "couldn't start" notice.
import('./main.jsx');
