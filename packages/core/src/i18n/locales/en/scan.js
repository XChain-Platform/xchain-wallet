// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `scan.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'scan.scannerAlt': 'Scan a QR code',
    'scan.routing': 'Scanned, routing…',
    'scan.pasteLabel': 'Or paste it here',
    'scan.pastePlaceholder': 'xchain:… / bitcoin:… / address / transaction code',
    'scan.classifyPaste': 'Use pasted text',
    'scan.error.pasteEmpty': 'Paste something first.',
    'scan.error.unknownXchainIntent':
        "This XChain link isn't supported. Check the link and try again.",
    'scan.error.paymentRequest':
        "This payment request doesn't match a supported network or valid address. Check the request and scan again, or paste the address instead.",
    'scan.error.wif':
        'This is a private key. Open Import wallet, choose Private key, and scan it there.',
    'scan.error.mnemonic':
        'This is a recovery phrase. Open Import wallet, choose Recovery phrase, and scan it there.',
    'scan.error.xcwChunk':
        'Part {n} of {total} of a multi-frame QR code was scanned. Open the screen that asked for this code and capture every frame there.',
    'scan.error.transactionHex':
        'This is a signed transaction. Open Broadcast transaction and scan or paste it there.',
    'scan.error.backupPointer':
        'This is an encrypted-backup code. Open Import wallet, choose Encrypted backup, and scan it there.',
    'scan.error.pairingCode':
        'This is a wallet pairing code. Open Pair a watcher or signer and scan it there.',
    'scan.error.unknown':
        "This QR code contains text the wallet doesn't know how to use. Scan a supported payment or transaction code, or paste it below instead.",
};

addEnglish(messages);

export default messages;
