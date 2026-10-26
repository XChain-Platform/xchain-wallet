// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `crossChainSwap.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'crossChainSwap.success.giveTxLabel': 'Give network transaction',
    'crossChainSwap.success.hint':
        'Your offer is open on the give network. The swap settles atomically when a counterparty fills it on the get network; until then no funds move.',
};

addEnglish(messages);

export default messages;
