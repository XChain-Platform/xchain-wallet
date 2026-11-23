// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `projectRoster.*` keys (the Project Tokens page).
// Every module that renders one of these keys imports this file, so the copy
// arrives with that module's chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'projectRoster.listSection': 'Official Tokens',
    'projectRoster.detailsSection': 'List Details',
    'projectRoster.tokenCount': '{count, plural, one {# token} other {# tokens}}',
    'projectRoster.noTokensSummary': 'None yet',
    'projectRoster.listName': 'List name',
    'projectRoster.listNameHelp': 'Shown with {tick}\'s project tokens in wallets and explorers, for example "{tick} game items". Stored on the chain with the list.',
    'projectRoster.descriptionHelp': 'A short note about what these tokens are and how they belong to the project. Stored on the chain with the list.',
    'projectRoster.byteCount': '{used} / {max}',
    'projectRoster.metaUnsupported': 'This network doesn\'t take a list name or description yet, so the list is saved with its tokens only.',
    'projectRoster.tokensHelp': 'Tokens on {tick}\'s list show an "Official" badge in explorers and wallets. Put one token per line, or add one from the token picker.',
    'projectRoster.addToken': 'Add Token',
    'projectRoster.pickerTitle': 'Add a Token',
    'projectRoster.loadingList': 'Loading the current project token list…',
    'projectRoster.notOwnerRepublish': 'This address doesn\'t own the current list, so saving publishes the list again and links it to {tick}.',
    'projectRoster.truncated': 'This list holds {total} tokens and the wallet loaded {loaded}, so tokens can\'t be changed here. The name and description can still be changed.',
    'projectRoster.duplicate': '{tick} is already on the list.',
    'projectRoster.otherNetwork': 'Pick a token on {network}. The project list counts only tokens on its own network.',
    'projectRoster.noChange': 'Nothing to save. Add or remove a token, or change the name or description.',
    'projectRoster.noTokensRefusal': 'Add at least one token to the list.',
    'projectRoster.truncatedRefusal': 'Tokens can\'t be changed here because the wallet couldn\'t load the whole list.',
    'projectRoster.fixDetails': 'Fix the list name and description first.',
    'projectRoster.detailsLoadError': 'Couldn\'t load the current list name and description. Try again in a moment.',
    'projectRoster.metaError.pipe': 'Can\'t contain the | character.',
    'projectRoster.metaError.semicolon': 'Can\'t contain the ; character.',
    'projectRoster.metaError.unsafe': 'Can\'t contain control, text-direction, or zero-width characters.',
    'projectRoster.metaError.length': 'Too long.',
    'projectRoster.metaError.format': 'A single - isn\'t allowed.',
    'projectRoster.create': 'Create and Link',
    'projectRoster.save': 'Update List',
    'projectRoster.steps.label': 'What saving does',
    'projectRoster.steps.saveList': 'Save the list',
    'projectRoster.steps.link': 'Link to {tick}',
    'projectRoster.steps.saved': 'List saved',
    'projectRoster.steps.linked': 'Linked to {tick}',
    'projectRoster.steps.updateList': 'Update the list in one transaction',
    'projectRoster.steps.updateDetails': 'Update the name and description in one transaction',
    'projectRoster.savedTitle': 'Project tokens saved',
    'projectRoster.metaTransaction': 'List details transaction',
    'projectRoster.updateTransaction': 'List update transaction',
    'projectRoster.savedHint': 'Once it confirms, explorers and wallets show the new name and description for {tick}\'s project tokens.',
    'projectRoster.updatedHint': 'Once it confirms, explorers and wallets show the updated list as {tick}\'s project tokens.',
    'projectRoster.networkHelp': 'The network of the token whose official list you publish, where the fee is paid.',
};

addEnglish(messages);

export default messages;
