// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `addressList.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'addressList.advancedNetworkHelp':
        'The coin network where the address will be generated using the address number below.',
    'addressList.balanceCheckWarning': "The balance couldn't be checked. This address may hold coins.",
    'addressList.hidden.show':
        '{count, plural, one {Show # hidden address} other {Show # hidden addresses}}',
    'addressList.hidden.hide':
        '{count, plural, one {Hide # hidden address} other {Hide # hidden addresses}}',
    'addressList.pagination':
        '{shown, number} of {total, plural, one {# address} other {# addresses}} shown',
    'addressList.wifNetworkHelp': 'The coin network this private key belongs to. The imported address joins this account on that network.',
    'addressList.wifAckHelp':
        'This address comes from the key, not from this wallet\'s recovery phrase, so restoring the phrase won\'t bring it back. Keep the key backed up on its own.',
};

addEnglish(messages);

export default messages;
