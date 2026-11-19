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
    'accountPicker.add': 'Add Account',
    'accountPicker.addNameHelp': 'Names a separate set of addresses in this wallet.',
    'accountPicker.defaultName': 'Account {number}',
    'accountPicker.empty.title': 'No accounts yet',
    'accountPicker.error.load': "Couldn't load accounts. Try again.",
    'accountPicker.loading': 'Loading accounts…',
    'accountPicker.loadingLabel': 'Loading accounts',
    'accountPicker.pageTitle': 'My Accounts',
    'accountPicker.empty.addBody': 'Add an account with the plus above.',
    'accountPicker.filter': 'Filter accounts',
    'accountPicker.searchLabel': 'Search accounts',
    'accountPicker.noMatchTitle': 'No matching accounts',
    'accountPicker.noMatchBody': 'Matching accounts appear here after you change the search.',

    // --- account details ------------------------------------------
    'accountPicker.details.title': 'Account Details',
    'accountPicker.details.actionsList': 'Account actions',
    'accountPicker.details.setActive': 'Set as active account',
    'accountPicker.details.setActiveLine': 'Use this account for balances, sends and receives',
    'accountPicker.details.edit': 'Edit account',
    'accountPicker.details.extendedKeysLine': 'Export the public keys another phone needs to view this account',
    'accountPicker.details.factsLabel': 'Account details',
    'accountPicker.details.number': 'Account number',
    'accountPicker.details.notActive': 'Not active',
    'accountPicker.details.loadFailed': "Couldn't load the account.",

    // --- account details: Addresses tab (G131) -------------------
    // One account's addresses by network, for every wallet type. The tab
    // reuses home.addresses and the empty title history.empty.noAddressesTitle.
    'accountPicker.details.addressesEmptyBody': 'Addresses appear here once this account has one on a network.',
};

addEnglish(messages);

export default messages;
