// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `unbindForm.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'unbindForm.title': 'Unbind Controller',
    'unbindForm.label': 'Unbind controller',
    'unbindForm.action': 'Unbind',
    'unbindForm.loadingAddresses': 'Loading addresses…',
    'unbindForm.loadingTokens': 'Loading tokens…',
    'unbindForm.noAddresses': 'No addresses on any network yet. Use Receive to generate one first.',
    'unbindForm.loadFailed': 'Failed to load addresses.',
    'unbindForm.noSource': 'No address on this network to sign from. Use Receive to generate one first.',
    'unbindForm.noSourceSelected': 'No source address available.',
    'unbindForm.sourceInvalid': "The selected source address isn't valid for this network.",
    'unbindForm.ownerPending': 'Wait for the wallet to verify the current owner of {tick}.',
    'unbindForm.classesRefreshing': 'Action classes are still refreshing for this network. Try again in a moment.',
    'unbindForm.failed': 'Unbind failed.',
    'unbindForm.networkHelp': 'The chain the token or address and its controller are on. Your From address and the fee are on this network.',
    'unbindForm.from': 'From',
    'unbindForm.fromHelp': 'The owner address that signs this unbind. Unbinding a token needs the token owner; unbinding an address uses that address.',
    'unbindForm.choosePicker': 'Choose source address',
    'unbindForm.pickerLocked': "The token's owner address signs this unbind",
    'unbindForm.fromPickerTitle': 'From Address',
    'unbindForm.section': 'Controller',
    'unbindForm.target': 'What to unbind',
    'unbindForm.targetHelp': 'Choose Token to remove a controller from a token this wallet owns. Choose Address to remove a controller from the From address.',
    'unbindForm.targetAddress': 'Address',
    'unbindForm.token': 'Token',
    'unbindForm.tokenHelp': 'The token this wallet owns whose controller is removed.',
    'unbindForm.selectToken': 'Select a token',
    'unbindForm.tokenRequired': 'Pick the token whose controller comes off.',
    'unbindForm.thisAddress': 'This address',
    'unbindForm.actionClass': 'Action class',
    'unbindForm.actionClassHelp': 'The class whose controller comes off. One unbind removes one class.',
    'unbindForm.allNote': 'Removes the catch-all binding. Class-specific bindings stay in place.',
    'unbindForm.ownershipNote': 'ownership: transfers of the token itself (including a sweep), not transfers of its balances.',
    'unbindForm.watcherNote': "Another phone signs for this wallet, so this creates an unsigned transaction and can't sign it.",
    'unbindForm.memo': 'Memo',
    'unbindForm.none': 'None',
    'unbindForm.summaryToken': 'Unbind controller on {tick} ({actionClass})',
    'unbindForm.summaryAddress': 'Unbind address controller ({actionClass})',
    'unbindForm.doneTitle': 'Unbind broadcast.',
    'unbindForm.doneMessage': 'The network will remove the controller shortly.',
    'unbindForm.transactionId': 'Transaction ID',
    'unbindForm.noTokensTitle': 'No owned tokens',
    'unbindForm.noTokensBody': 'Tokens owned by this wallet on this network appear here.',
    'unbindForm.networkFee': 'Network fee: {amount} {coin}',
};

addEnglish(messages);

export default messages;
