// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `batch.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'batch.transactionsLabel': 'Transactions',
    'batch.transactionNumber': 'Transaction {number}',
    'batch.changeSource': 'Change the network and From address of transaction {number}',
    'batch.actionsOf': 'Actions in transaction {number}',
    'batch.addToTransaction': 'Add to This Transaction',
    'batch.addNetwork': 'Add Another Network',
    'batch.review': '{count, plural, one {Review # Transaction} other {Review # Transactions}}',
    'batch.chooseAction': 'Choose an action',
    'batch.rowTo': 'to {address}',
    'batch.rowSupply': '{supply} supply',
    'batch.editRow': 'Edit action {number}',
    'batch.removeRow': 'Remove',
    'batch.pickFrom': 'Transaction {number}: pick a From address.',
    'batch.duplicate':
        'Transaction {number} uses the same network and From address as transaction {first}. Add its actions there instead.',
    'batch.notAtomic':
        'These are {count} separate transactions, signed one after another. Each one is confirmed on its own: if a later one fails, the earlier ones have already gone through.',
    'batch.networkFeeFor': 'Network fee: {amount} {ticker}',
    'batch.partialSent':
        '{sent, plural, one {# transaction went through} other {# transactions went through}} before the rest stopped. The others were not sent.',
    'batch.allSent': '{count, plural, one {# transaction sent} other {# transactions sent}}',
};

addEnglish(messages);

export default messages;
