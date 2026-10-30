// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `addressDiscovery.*` keys: the used-address check that
// runs after a restore and from Wallet details. Every module that renders one
// of these keys imports this file.

import { addEnglish } from '../../store.js';

const messages = {
    'addressDiscovery.checking':
        'Checking for used addresses ({done} of {total, plural, one {# network} other {# networks}} checked)',
    'addressDiscovery.found':
        '{count, plural, =0 {Found no other used addresses} one {Found # used address} other {Found # used addresses}}',
    'addressDiscovery.failed': "Couldn't finish checking for used addresses on {chains}. Try again",
    'addressDiscovery.action': 'Check for used addresses',
};

addEnglish(messages);

export default messages;
