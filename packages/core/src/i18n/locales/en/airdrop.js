// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `airdrop.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'airdrop.reviewAirdrop': 'Review Airdrop',
    'airdrop.title.reviewTokenList': 'Review Token List',
    'airdrop.title.reviewAddressList': 'Review Address List',
    'airdrop.title.waitingForIndex': 'Waiting for List to Be Indexed',
    'airdrop.title.complete': 'Airdrop Complete',
    'airdrop.title.compose': 'Airdrop Tokens',
    'airdrop.picker.selectToken': 'Select Token',
    'airdrop.picker.addToken': 'Add a Token',
    'airdrop.picker.chooseList': 'Choose a List',
    'airdrop.summary.existingList': 'existing list',
    'airdrop.summary.holders': 'holders of {count} {count, plural, one {token} other {tokens}}',
    'airdrop.summary.addresses': '{count} {count, plural, one {address} other {addresses}}',
    'airdrop.summary.each': '{amount} {tick} each',
    'airdrop.action.reviewRecipients': 'Review Recipients',
    'airdrop.otherChain.notice': "Before you approve: {count, plural, one {# address} other {# addresses}} on this list {count, plural, one {belongs} other {belong}} to another coin network, so the airdrop can't deliver to {count, plural, one {it} other {them}}.",
    'airdrop.from.networkHelp': 'The chain the airdrop is recorded on. Your From address, token, recipients, and fees are on this network.',
    'airdrop.from.addressHelp': 'The address that sends the airdrop. It must hold the token and pays the fees.',
    'airdrop.section.airdrop': 'Airdrop',
    'airdrop.file.label': 'Recipients file (CSV or TXT)',
    'airdrop.file.help': 'A CSV or text file of addresses, one per line or comma-separated. Its addresses fill the Recipients box above, where you can check them before publishing.',
    'airdrop.file.inputLabel': 'Upload CSV of addresses',
    'airdrop.ticksFile.label': 'Tokens file (CSV or TXT)',
    'airdrop.ticksFile.help': 'A CSV or text file of token tickers, one per line. Its tokens fill the Tokens box above, where you can check them before publishing.',
    'airdrop.ticksFile.inputLabel': 'Upload CSV of tokens',
    'airdrop.ticksFile.badLines': '{count} {count, plural, one {line is} other {lines are}} not a token name:',
    'airdrop.ticksFile.badLine': 'Line {line}:',
};

addEnglish(messages);

export default messages;
