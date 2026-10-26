// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `keyboard.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // Copy moved out of JSX literals by the i18n sweep.
    'keyboard.shortcutHelp.keyboardShortcuts': 'Keyboard shortcuts',
    'keyboard.shortcutHelp.shortcutList': 'Shortcut list',
    'keyboard.shortcutHelp.browserExtension': 'Browser extension',
    'keyboard.shortcutHelp.notSet': 'Not set',
    'keyboard.shortcutHelp.rebindWalletShortcutsInSettings':
        'Rebind wallet shortcuts in Settings → Keyboard.',
    'keyboard.shortcutHelp.manageBrowserExtensionShortcutsIn':
        ' Manage browser extension shortcuts in your browser.',
};

addEnglish(messages);

export default messages;
