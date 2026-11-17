// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `gatedPublish.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- gated publishing ----------------------------------------
    'gatedPublish.title': 'Gated Content · {tick}',
    'gatedPublish.watcherSavedKey':
        'The pack key is saved in this wallet. Sign the transaction on the phone that signs for this wallet, then broadcast it from a wallet that can send it to the network.',
    'gatedPublish.queuedWhat': 'gated file publish',
    'gatedPublish.success': 'Encrypted file published',
    'gatedPublish.transaction': 'Transaction:',
    'gatedPublish.packKeyHash': 'Pack key hash:',
    'gatedPublish.successHint.beforeToken':
        'The decryption key is stored in this wallet and recorded on-chain encrypted to your own address. Anyone who receives',
    'gatedPublish.successHint.afterToken':
        'through a normal send gets the key automatically. To add more files that unlock together, publish again and pick this pack.',
    'gatedPublish.pack.new': 'New pack (fresh key)',
    'gatedPublish.previewAlt': 'Preview of {file}',
    'gatedPublish.fileMetadata': '{name} · {bytes} · {type}',
    'gatedPublish.pack': 'Pack',
    'gatedPublish.unlockThreshold': 'Unlock threshold',
    'gatedPublish.permanentHint':
        "Permanent: the encrypted bytes live on-chain forever and the gate can't be removed later, only the key re-shared. One transaction publishes the file and records your recovery copy of the key; there is no key-less window.",
    'gatedPublish.watcherHint':
        'Another phone signs for this wallet: this prepares the transaction for it. The pack key stays in this wallet either way.',
    'gatedPublish.gatedContent': 'Gated content',
    'gatedPublish.fromHelp':
        "Only this token's current owner can publish gated files for it.",
    'gatedPublish.tokens.noneTitle': 'No owned tokens',
    'gatedPublish.tokens.noneBody':
        'Only tokens you own can publish gated files for their holders.',
    'gatedPublish.tokens.lookupFailed':
        'Unable to look up all owned tokens. The current gate token is still available.',
    'gatedPublish.tokens.lookupPartial':
        'Some token ownership checks failed. The token list may be incomplete.',
    'gatedPublish.formHint.beforeToken': 'Publish a file that only holders of',
    'gatedPublish.formHint.afterToken':
        'can read. The file is encrypted before it touches the network; the key travels automatically with every normal send of the token.',
    'gatedPublish.fileLimit': 'File (up to {bytes})',
    'gatedPublish.fileToPublish': 'File to publish',
    'gatedPublish.titleField': 'Title',
    'gatedPublish.titleHelp':
        'Add an optional title that token holders will see with the encrypted file.',
    'gatedPublish.noThreshold': 'No threshold',
    'gatedPublish.thresholdHint':
        'Holders need at least this many {tick} after a send to receive the unlock key. This is a first-access lock, not copy protection: anyone who ever got the key keeps it, even if they later hold less.',
    'gatedPublish.pack.add': 'Add to pack',
    'gatedPublish.pack.unlockTogether': '(files in this pack unlock together)',
    'gatedPublish.pack.loading': 'Loading reusable packs…',
    'gatedPublish.pack.empty':
        'Files published under one pack share a single key and unlock together.',
    'gatedPublish.noAddress': 'No address in this wallet can publish for {tick} on this network.',
    'gatedPublish.sectionFile': 'File',
    'gatedPublish.sectionAccess': 'Access',
    'gatedPublish.confirmNotice':
        'The encrypted file stays on the blockchain for good, and only {tick} holders can unlock it.',
    'gatedPublish.tokenHelp':
        'The token whose holders can unlock this file. Only tokens you own are listed.',
    'gatedPublish.tokens.pickToken': 'Pick the token whose holders can unlock this file.',
    'gatedPublish.tokens.noneSummary': 'Gated',
    'gatedPublish.tokens.lookingUp': 'Looking up tokens you own…',
    'gatedPublish.tokens.lookupUnavailable': "This wallet can't look up tokens for gated publishing.",
    'gatedPublish.tokens.lookupFailedNoToken':
        "Couldn't look up tokens for gated publishing. Check your connection and reopen this screen.",
    'gatedPublish.tokens.noneToGate':
        "Only a token's owner can publish gated files for it, so create a token first and then publish gated content for its holders.",
    'gatedPublish.formHint.noToken':
        'Publish a file that only holders of the token you pick can read. The file is encrypted before it touches the network; the key travels automatically with every normal send of the token.',
    'gatedPublish.carriedTooLarge':
        'This file is {bytes}; an encrypted file can be at most {max} with this title and memo. Pick a smaller file or publish it as Public.',
    'gatedPublish.networkHelp': 'The network the file is published on; a token-gated file goes on the gate token\'s network.',
};

addEnglish(messages);

export default messages;
