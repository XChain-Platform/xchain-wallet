// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `governance.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- governance ----------------------------------------------
    'governance.title': 'Governance',
    'governance.noAddress.title': 'No governance address',
    'governance.noAddress.body': 'Governance requires an address on a supported network.',
    'governance.createPoll': 'Create poll',
    'governance.delegateVotes': 'Delegate votes',
    'governance.loadingAddresses': 'Loading governance addresses…',
    'governance.loadingAddressesLabel': 'Loading governance addresses',
    'governance.loadingPolls': 'Loading governance polls…',
    'governance.loadingPollsLabel': 'Loading governance polls',
    'governance.error.addresses': "Couldn't load governance addresses. Try again.",
    'governance.error.polls': "Couldn't load governance polls. Try again.",
    'governance.empty.title': 'No polls yet',
    'governance.empty.body': 'Polls created on this network appear here.',
    'governance.closesAtBlock': 'Closes at block {block}',
};

addEnglish(messages);

export default messages;
