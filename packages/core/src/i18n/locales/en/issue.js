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
    'issue.reviewTitle': 'Review issue',
    'issue.title': 'Issue token',
    'issue.issuance': 'issuance',
    'issue.success': 'Token issued',
    'issue.broadcastComplete': 'Broadcast complete.',
    'issue.reviewTokenIssue': 'Review token issue',
    'issue.draft.unfinished':
        'Your unfinished issue draft was saved. Restore it to continue. Nothing was submitted.',
    'issue.ticker': 'Ticker',
    'issue.tickerTaken': 'Ticker "{ticker}" already exists on this network.',
    'issue.supply': 'Supply',
    'issue.supplyHint': 'The most that can ever exist.',
    'issue.initialMintOptional': 'Initial mint (optional)',
    'issue.initialMintHeadroom': 'Leaves {amount} to mint later.',
    'issue.initialMintHint':
        'How much exists at creation. Leave blank to mint the whole supply now; a smaller number leaves the rest to mint later.',
    'issue.maxMintOptional': 'Max mint per transaction (optional)',
    'issue.maxMintHint': 'Caps how much can be minted in one transaction. Leave blank for no limit.',
    'issue.divisible': 'Divisible (8 decimal places)',
    'issue.descriptionOptional': 'Description (optional)',
    'issue.descriptionHint': 'Up to 249 characters. Stored on-chain.',
    'issue.lockSupply': 'Lock supply + minting (irreversible)',
    'issue.lockSupplyWarning':
        'Locking minting means the {amount} left under the cap can never be minted. Clear this box to mint it later.',
    'issue.bridgingHint':
        'Bridging is off. After the token exists you can open it to other networks from Manage Token, set how deep a lock must be buried before validators sign it, and freeze both settings for your holders.',
    'issue.boundListHint':
        "One thing to decide now: a token bound to an address allow-list or block-list can't be bridged, and a bound list can never be cleared. If you may want this token on other networks, don't bind a list to it.",
    'issue.transferOwnershipOptional': 'Transfer ownership to (optional)',
    'issue.transferOwnershipHint':
        "Leave blank to keep control. Transferring ownership doesn't move the minted tokens; use the field below to send those too.",
    'issue.sendInitialMintOptional': 'Send the initial mint to (optional)',
    'issue.sendInitialMintHint': 'Leave blank to keep the minted tokens at the issuing address.',
};

addEnglish(messages);

export default messages;
