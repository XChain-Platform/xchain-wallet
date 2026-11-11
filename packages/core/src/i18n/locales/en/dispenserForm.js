// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `dispenserForm.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // AmountField appends the unit in brackets, so these labels carry none.
    'dispenserForm.giveAmountPerFill': 'Give amount per fill',
    'dispenserForm.paymentAmountPerFill': 'Payment amount per fill',
    'dispenserForm.networkHelp': 'The chain where the dispenser is opened. Its addresses, token, payments, and fees are on this network.',
    'dispenserForm.tokenHelp': 'The token locked in the dispenser and sent to buyers when they pay. Only tokens available to send from this wallet are listed.',
};

addEnglish(messages);

export default messages;
