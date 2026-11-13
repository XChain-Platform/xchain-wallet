// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `issue.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- token issue ---------------------------------------------
    'issue.reviewTitle': 'Review Issue',
    'issue.title': 'Issue Token',
    'issue.issuance': 'issuance',
    'issue.success': 'Token issued',
    'issue.broadcastComplete': 'Broadcast complete.',
    'issue.reviewTokenIssue': 'Review token issue',
    'issue.draft.unfinished':
        'Your unfinished issue draft was saved. Restore it to continue. Nothing was submitted.',
    'issue.networkHelp': 'The chain the token is issued on. Your From address and the network fee are on this network.',
    'issue.ticker': 'Ticker',
    'issue.tickerTaken': 'Ticker "{ticker}" already exists on this network.',
    'issue.irreversible': 'Irreversible',
    'issue.section.publicMinting': 'Public minting',
    'issue.section.description': 'Description',
    'issue.section.locks': 'Locks',
    'issue.section.lists': 'Allow and block lists',
    'issue.section.ownership': 'Transfer ownership',
    'issue.summary.notSet': 'Not set',
    'issue.summary.setCount': '{count} set',
    'issue.summary.descriptionAdded': 'Added',
    'issue.summary.oneLockOn': '1 lock on',
    'issue.summary.locksOn': '{count} locks on',
    'issue.summary.set': 'Set',
    'issue.summary.newOwner': 'New owner set',
    'issue.supply': 'Supply',
    'issue.fromHelp':
        'This address issues and owns the new token and pays the issuance and network fees.',
    'issue.maxSupply': 'Max supply',
    'issue.supplyHint': 'The most that can ever exist.',
    'issue.initialMint': 'Initial mint',
    'issue.initialMintHeadroom': 'Leaves {amount} to mint later.',
    'issue.initialMintHint':
        'How much exists at creation. Leave blank to mint the whole supply now; a smaller number leaves the rest to mint later.',
    'issue.maxMint': 'Max per transaction',
    'issue.maxMintHelp':
        'The most anyone can create in one public mint transaction for this new token.',
    'issue.mintAddressMax': 'Max per address',
    'issue.mintAddressMaxHelp':
        'The total amount any one address can create through public minting for this new token.',
    'issue.mintStartBlock': 'Start block',
    'issue.mintStartBlockHelp':
        'The block height when public minting for this new token opens.',
    'issue.mintStopBlock': 'Stop block',
    'issue.mintStopBlockHelp':
        'The block height when public minting for this new token closes.',
    'issue.descriptionAria': 'Token description',
    'issue.allowList': 'Allow list',
    'issue.allowListHelp':
        'The number of the address list whose members may hold or transfer this new token. Everyone else is denied.',
    'issue.blockList': 'Block list',
    'issue.blockListHelp':
        'The number of the address list whose members may not hold or transfer this new token.',
    'issue.divisible': 'Divisible (8 decimal places)',
    'issue.transferOwnership': 'New owner address',
    'issue.transferOwnershipHint':
        "Leave blank to keep control. Transferring ownership doesn't move the minted tokens; set their destination in Supply.",
    'issue.sendInitialMint': 'Send initial mint to',
    'issue.sendInitialMintHint': 'Leave blank to keep the minted tokens at the issuing address.',
    'issue.selectTemplate': 'Select template',
    'issue.offline': 'Creating a token needs a network connection.',
    'issue.parentTicker': 'Parent ticker',
    'issue.parentTickerHelp':
        'The token you own that this subtoken is created under. It may itself be a subtoken.',
    'issue.subtokenName': 'Subtoken name',
    'issue.subtokenNetworkHelp':
        'The chain the subtoken is created on. It must be the chain where its parent token lives.',
    'issue.subtokenFromHelp': 'A subtoken can only be issued by the address that owns its parent.',
    'issue.imageUrl': 'Image URL',
    'issue.imageUrlHelp':
        "Where the artwork lives (https, http, ipfs or ar). It's stored as the token's description.",
    'issue.chooseAllowListTitle': 'Choose Allow-List',
    'issue.chooseBlockListTitle': 'Choose Block-List',
    'issue.chooseAllowList': 'Choose allow-list',
    'issue.changeAllowList': 'Change allow-list',
    'issue.removeAllowList': 'Remove allow-list',
    'issue.chooseBlockList': 'Choose block-list',
    'issue.changeBlockList': 'Change block-list',
    'issue.removeBlockList': 'Remove block-list',
    'issue.removeList': 'Remove',
    'issue.section.callback': 'Callback',
    'issue.summary.callback': '{amount} {ticker} per unit',
    'issue.callbackTick': 'Callback token',
    'issue.callbackTickHelp':
        "The ticker holders are paid in when you call back. Must be a token you'll hold enough of to cover every holder.",
    'issue.callbackAmount': 'Payout per unit',
    'issue.callbackAmountHelp': 'How much of the callback token each holder receives per unit they hold.',
    'issue.callbackAmountDecimals': 'Up to {count} decimal places.',
    'issue.callbackAmountDecimal': 'Up to 1 decimal place.',
    'issue.callbackAmountWhole': 'Whole numbers only until the wallet can confirm the callback token is divisible.',
    'issue.callbackBlock': 'Callback allowed from block',
    'issue.callbackBlockHelp': 'The earliest block height you can trigger the callback. Must be a future block.',
    'issue.callbackBlockEstimate': 'Est. {estimate}.',
    'issue.callbackCurrentBlock': 'Current block: {height}.',
    'issue.descriptionHelp': "A public note stored with the token on the chain, such as what it's for or a link.",
    'issue.divisibleHelp': 'On lets holders own and send fractions of the token; off keeps every amount a whole number.',
};

addEnglish(messages);

export default messages;
