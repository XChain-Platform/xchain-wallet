// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `balances.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'balances.unchecked.title': "Balances couldn't be checked",
    'balances.unchecked.body': 'Your balance may be out of date. Try again to refresh it.',

    // Copy moved out of JSX literals by the i18n sweep.
    'balances.noBalancesYet': 'No balances yet',
    'balances.xchainPlatformCoinsAndTokens':
        'XChain Platform coins and tokens appear here after this wallet receives funds on Bitcoin, Litecoin, or Dogecoin.',
    'balances.balances': 'Balances',
    'balances.balanceHidden': 'Balance hidden',
    'balances.unavailable': 'Unavailable',
    'balances.pendingBalanceHidden': 'Pending balance hidden',
    'balances.pending': '••• pending',
    'balances.pending2': '{formatAmountValue} pending',
    'balances.fiatValueHidden': 'Fiat value hidden',
    'balances.fiatValueUnavailable': 'Fiat value unavailable',
    'balances.balanceCouldnTBeLoaded': "Balance couldn't be loaded",
    'balances.unpin': 'Unpin {tick}',
    'balances.pin': 'Pin {tick}',
    'balances.unpin2': 'Unpin',
    'balances.pinToTop': 'Pin to top',
    'balances.unhide': 'Unhide {tick}',
    'balances.hide': 'Hide {tick}',
};

addEnglish(messages);

export default messages;
