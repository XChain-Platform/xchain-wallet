// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `uploadMethod.*` keys (UploadMethodField and the
// review rows of the three file forms).

import { addEnglish } from '../../store.js';

const messages = {
    'uploadMethod.label': 'Upload method',
    'uploadMethod.help': 'How the file reaches the chain. Taproot upload writes the whole file into one Taproot input, with a commit and a reveal transaction, and costs the least. Standard is the original lane: small files ride one data output, larger ones are split into script outputs that a second transaction reveals.',
    'uploadMethod.taproot': 'Taproot upload',
    'uploadMethod.taprootDescription': 'One commit, then a reveal carrying the whole file.',
    'uploadMethod.standard': 'Standard',
    'uploadMethod.standardDescription': 'The original lane: the file split into small script outputs.',
    'uploadMethod.cheapest': 'Cheapest',
    'uploadMethod.fee': 'Network fee about {amount} {ticker}',
    'uploadMethod.reason.hardware': "Hardware wallets can't sign the reveal transaction yet.",
    'uploadMethod.reason.watcher': "Not available when another phone signs: it can't sign the reveal.",
    'uploadMethod.reason.watchOnly': "A watch-only address can't sign the reveal transaction.",
    'uploadMethod.reason.signer': "This From address can't sign the reveal transaction.",
    'uploadMethod.reason.litecoinPending': 'Not on Litecoin until the wallet turns on Taproot addresses.',
    'uploadMethod.reason.noTaproot': 'Dogecoin has no Taproot.',
    'uploadMethod.reason.chain': 'This network has no Taproot.',
    'uploadMethod.reason.tooLarge': 'This file is too large for it: Standard carries up to {cap}.',
    'uploadMethod.review.fee': 'Estimated upload fee',
    'uploadMethod.confirmLine': 'Upload method: {method}.',
};

addEnglish(messages);

export default messages;
