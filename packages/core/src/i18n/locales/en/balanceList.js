// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `balanceList.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'balanceList.hiddenTokens.show':
        '{count, plural, one {Show # hidden token} other {Show # hidden tokens}}',
    'balanceList.hiddenTokens.hide':
        '{count, plural, one {Hide # hidden token} other {Hide # hidden tokens}}',
    'balanceList.smallBalances.show':
        '{count, plural, one {Show # small balance} other {Show # small balances}}',
    'balanceList.smallBalances.hide':
        '{count, plural, one {Hide # small balance} other {Hide # small balances}}',
    'balanceList.rowChainSpeech': 'on {chain}',
};

addEnglish(messages);

export default messages;
