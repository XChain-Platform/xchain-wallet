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
    'gatedPublish.review.title': 'Review gated publish',
    'gatedPublish.title': 'Gated content · {tick}',
    'gatedPublish.watcherSavedKey':
        'The pack key is saved in this wallet. Sign the transaction with your signer wallet, then broadcast it from a wallet that can send it to the network.',
    'gatedPublish.queuedWhat': 'gated file publish',
    'gatedPublish.success': 'Encrypted file published',
    'gatedPublish.transaction': 'Transaction:',
    'gatedPublish.packKeyHash': 'Pack key hash:',
    'gatedPublish.successHint.beforeToken':
        'The decryption key is stored in this wallet and recorded on-chain encrypted to your own address. Anyone who receives',
    'gatedPublish.successHint.afterToken':
        'through a normal send gets the key automatically. To add more files that unlock together, publish again and pick this pack.',
    'gatedPublish.pack.new': 'New pack (fresh key)',
    'gatedPublish.signAndPublish': 'Sign and publish',
    'gatedPublish.review.summary.beforeFile': 'Publish',
    'gatedPublish.review.summary.afterFile': 'encrypted; only holders of {tick} will be able to read it.',
    'gatedPublish.previewAlt': 'Preview of {file}',
    'gatedPublish.file': 'File',
    'gatedPublish.gateToken': 'Gate token',
    'gatedPublish.fileMetadata': '{name} · {bytes} bytes · {type}',
    'gatedPublish.pack': 'Pack',
    'gatedPublish.unlockThreshold': 'Unlock threshold',
    'gatedPublish.thresholdReview': 'hold ≥ {amount} {tick} to receive the key',
    'gatedPublish.publishingFrom': 'Publishing from',
    'gatedPublish.permanentHint':
        "Permanent: the encrypted bytes live on-chain forever and the gate can't be removed later, only the key re-shared. One transaction publishes the file and records your recovery copy of the key; there is no key-less window.",
    'gatedPublish.watcherHint':
        'Watcher mode: this builds an unsigned transaction. The pack key stays in this wallet either way.',
    'gatedPublish.gatedContent': 'Gated content',
    'gatedPublish.formHint.beforeToken': 'Publish a file that only holders of',
    'gatedPublish.formHint.afterToken':
        'can read. The file is encrypted before it touches the network; the key travels automatically with every normal send of the token.',
    'gatedPublish.fileLimit': 'File (up to about {bytes} bytes)',
    'gatedPublish.fileToPublish': 'File to publish',
    'gatedPublish.titleOptional': 'Title (optional)',
    'gatedPublish.titleField': 'Title',
    'gatedPublish.memoOptional': 'Memo (optional)',
    'gatedPublish.unlockThresholdOptional': 'Unlock threshold (optional)',
    'gatedPublish.noThreshold': 'No threshold',
    'gatedPublish.thresholdHint':
        'Holders need at least this many {tick} after a send to receive the unlock key. This is a first-access lock, not copy protection: anyone who ever got the key keeps it, even if they later hold less.',
    'gatedPublish.pack.add': 'Add to pack',
    'gatedPublish.pack.unlockTogether': '(files in this pack unlock together)',
    'gatedPublish.pack.loading': 'Loading reusable packs…',
    'gatedPublish.pack.emptyTitle': 'No reusable packs yet',
    'gatedPublish.pack.empty':
        'Files published under one pack share a single key and unlock together.',
    'gatedPublish.ackForever':
        "I understand the encrypted file is published on-chain forever and the gate can't be removed later.",
};

addEnglish(messages);

export default messages;
