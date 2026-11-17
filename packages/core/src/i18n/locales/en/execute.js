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
    'execute.review.title': 'Review Contract Call',
    'execute.loadingAddresses': 'Loading addresses…',
    'execute.success': 'Method call broadcast.',
    'execute.contract': 'Contract',
    // The form's fixed title; the contract shows as the main section's first field.
    'execute.title': 'Execute Contract',
    'execute.contractHelp': 'The contract whose method this calls. Use the list icon to pick another contract.',
    'execute.pickContract': 'Choose another contract',
    'execute.deposit': 'Deposit',
    'execute.tokenLabel': 'Token',
    'execute.method': 'Method',
    'execute.params': 'Arguments',
    'execute.protocolFee': 'Protocol fee',
    'execute.tokenToDeposit': 'Token to Deposit',
    'execute.callContract': 'Call Contract',
    'execute.caller': 'From',
    'execute.callerHelp': 'The address that calls the contract, pays the network and call fees, and signs.',
    'execute.methodHelp': 'The contract method to call, from the methods the contract declares.',
    'execute.paramHelp': 'Argument {name}, of type {type}, passed to the method.',
    'execute.methodsLoading': 'Loading the contract’s methods…',
    'execute.methodsLoadFailed': 'Couldn’t load this contract’s methods. Check your connection and try again.',
    'execute.noMethods': 'This contract doesn’t declare any methods to call.',
    'execute.chooseMethod': 'Choose a method.',
    'execute.linkUnknownMethod': 'This link names the method {method}, but this contract doesn’t declare it. Choose a method from the list.',
    'execute.linkTooManyArgs': 'This link passes more arguments than {method} takes ({count}). Choose a method from the list.',
    'execute.noDeposit': 'No deposit',
    'execute.depositTokenHelp':
        'An optional token sent into the contract in the same transaction, before the method runs. Leave it empty to call the method without a deposit.',
    'execute.depositAmount': 'Deposit amount',
    'execute.depositHint':
        'Sent into contract #{contract} in the same transaction, before the call. Only tokens on {chain} can be deposited.',
    'execute.balanceAvailable': '{amount} {tick} available',
    'execute.removeDeposit': 'Remove Deposit',
    'execute.networkHelp': 'The network the contract runs on, fixed by the contract you are calling.',
};

addEnglish(messages);

export default messages;
