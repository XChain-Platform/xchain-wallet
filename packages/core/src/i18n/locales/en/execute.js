// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `execute.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- contract execution --------------------------------------
    'execute.review.title': 'Review contract call',
    'execute.loadingAddresses': 'Loading addresses…',
    'execute.success': 'Method call broadcast.',
    'execute.review.summary.deposit':
        'Deposit {quantity} {tick}, then call {method}{args} on contract #{contract}.',
    'execute.review.summary.call': 'Call {method}{args} on contract #{contract}.',
    'execute.review.args': '{count, plural, one { with # argument} other { with # arguments}}',
    'execute.contract': 'Contract',
    'execute.deposit': 'Deposit',
    'execute.method': 'Method',
    'execute.params': 'Arguments',
    'execute.protocolFee': 'Protocol fee',
    'execute.protocolFee.native': 'Paid in {coin}',
    'execute.protocolFee.xchain': 'Paid from your XCHAIN balance',
    'execute.nativeCoin': 'the native coin',
    'execute.tokenToDeposit': 'Token to deposit',
    'execute.callContract': 'Call contract',
    'execute.caller': 'From',
    'execute.callerHelp': 'The address that calls the contract, pays the network and call fees, and signs.',
    'execute.methodHelp': 'The contract method to call, from the methods the contract declares.',
    'execute.paramHelp': 'Argument {name}, of type {type}, passed to the method.',
    'execute.enterMethodManually': 'Enter method manually',
    'execute.methodHint': 'Name of the contract method to call.',
    'execute.paramsHint': 'Separate arguments with |, for example foo|42|bc1q… Leave blank if the method takes no arguments.',
    'execute.useDeclaredMethods': 'Use declared methods',
    'execute.noDeposit': 'No deposit',
    'execute.depositTokenHelp':
        'An optional token sent into the contract in the same transaction, before the method runs. Leave it empty to call the method without a deposit.',
    'execute.depositAmount': 'Deposit amount',
    'execute.depositHint':
        'Sent into contract #{contract} in the same transaction, before the call. Only tokens on {chain} can be deposited.',
    'execute.balanceAvailable': '{amount} {tick} available',
    'execute.removeDeposit': 'Remove deposit',
};

addEnglish(messages);

export default messages;
