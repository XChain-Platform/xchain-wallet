// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// chrome.storage.local key the extension's layout-mode choice lives under.
// It sits in its own module so the Open-as toggle, which imports the
// translator, does not carry a dotted string that reads as a message key.
// The extension worker keeps its own copy in
// packages/extension/src/background/layoutMode.js.
export const LAYOUT_MODE_STORAGE_KEY = 'xchain.layoutMode';
