// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `publishFile.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'publishFile.title': 'Publish File',
    'publishFile.publishing': 'Publishing File…',
    'publishFile.titleReview': 'Review Publish',
    'publishFile.formLabel': 'Publish file',
    'publishFile.reviewLabel': 'Review publish',
    'publishFile.queuedWhat': 'file publish',
    'publishFile.loadNoAddress': 'No address on any network yet. Use Receive to generate one first.',
    'publishFile.fileEmpty': 'That file is empty.',
    'publishFile.fileUnreadable': "Couldn't read that file.",
    'publishFile.fileTooLarge': 'That file is {size}; with this metadata the on-chain ceiling is {cap}.',
    'publishFile.metadataTooLarge': 'With this title/memo the on-chain ceiling is {cap} and the file is {size}. Shorten the title or memo.',
    'publishFile.pickFile': 'Pick a file first.',
    'publishFile.quote.wait': 'Wait for the wallet to work out the parts and the fee.',
    'publishFile.quote.failed': "The wallet couldn't work out the parts and the fee. Choose the file again.",
    'publishFile.noSigner': 'No signing address available on this network.',
    'publishFile.fileNameBadCharacters': "File name can't contain | or ;",
    'publishFile.titleBadCharacters': "Title can't contain | or ;",
    'publishFile.memoBadCharacters': "Memo can't contain | or ;",
    'publishFile.signOnConfirm': 'Publishing is signed on the confirm screen. Go back and select Publish File again.',
    'publishFile.failed': 'Publish failed.',
    'publishFile.publishAs.legend': 'Publish as',
    'publishFile.publishAs.help': 'Choose whether this file is readable by everyone or encrypted for holders of a token you own.',
    'publishFile.publishAs.public': 'Public',
    'publishFile.publishAs.publicDescription': 'Anyone can read the file straight from the chain.',
    'publishFile.publishAs.gated': 'Encrypted & token-gated',
    'publishFile.publishAs.gatedDescription': 'Only holders of a token you own can unlock the encrypted file.',
    'publishFile.confirm.notice': "The file stays on the blockchain for good and can't be deleted.",
    'publishFile.done.title': 'File published',
    'publishFile.done.transaction': 'Transaction',
    'publishFile.done.actionIndex': 'Action index',
    'publishFile.done.hint': "Once it confirms, the file lives on the chain permanently and is readable by anyone. To make it a token's official artwork, use Attach artwork on that token's manage page.",
    'publishFile.review.createUnsigned': 'Create Unsigned Transaction',
    'publishFile.review.signAndPublish': 'Sign and Publish',
    'publishFile.review.from': 'Publishing from',
    'publishFile.review.permanent': "Permanent: the published bytes live on-chain forever and can't be deleted or edited later.",
    'publishFile.previewAlt': 'Preview of {name}',
    'publishFile.previewAltFile': 'Preview of file',
    'publishFile.from.networkHelp': "The chain the file is published on. Your From address and the fee are on this network, and the file's bytes are stored in transactions on it.",
    'publishFile.from.addressHelp': "The wallet address that pays the network fee and is recorded as the file's publisher.",
    'publishFile.titleField.help': 'A short label stored on-chain with the published file.',
    'publishFile.fileField.label': 'File (up to {cap})',
    'publishFile.fileField.help': 'Up to about {cap} with the current title and memo. The ceiling is exact per upload: shorter names and titles leave a little more room for the file itself.',
    'publishFile.fileField.helpEnvelope': 'This network and account support the compact Taproot encoding, which is what makes the larger ceiling possible. Files are compressed automatically when that makes them smaller, so what lands on-chain is often well under the size shown here.',
    'publishFile.fileField.helpLegacy': 'Files are compressed automatically when that makes them smaller, so what lands on-chain is often less than the file size.',
    'publishFile.details.type': 'Type',
    'publishFile.details.size': 'Size',
    'publishFile.details.bytes': '{bytes}',
    'publishFile.multipartFallback': "The multi-part upload couldn't continue. Try again or use Unfinished uploads.",
    'publishFile.multipartStopped': "The multi-part upload couldn't continue.",
};

addEnglish(messages);

export default messages;
