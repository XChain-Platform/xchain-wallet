// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `accountPicker.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- account picker ------------------------------------------
    'accountPicker.title': 'Accounts',
    'accountPicker.add': 'Add account',
    'accountPicker.manage': 'Manage',
    'accountPicker.defaultName': 'Account {number}',
    'accountPicker.renameLabel': 'Rename {label}',
    'accountPicker.renameTitle': 'Rename account',
    'accountPicker.empty.title': 'No accounts yet',
    'accountPicker.empty.body': 'Accounts added to this wallet appear here.',
    'accountPicker.error.load': "Couldn't load accounts. Try again.",
    'accountPicker.loading': 'Loading accounts…',
    'accountPicker.loadingLabel': 'Loading accounts',
};

addEnglish(messages);

export default messages;
