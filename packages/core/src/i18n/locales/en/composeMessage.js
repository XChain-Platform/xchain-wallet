// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `composeMessage.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // Copy moved out of JSX literals by the i18n sweep.

    // Titles, labels and placeholders.
    'composeMessage.newTitle': 'New message',
    'composeMessage.reviewTitle': 'Review message',
    'composeMessage.loadingWallet': 'Loading wallet…',
    'composeMessage.recipientPlaceholder': 'Recipient address',
    'composeMessage.messagePlaceholder': 'Write your message…',
    'composeMessage.attachmentLabel': 'Attachment',
    'composeMessage.encryptionLabel': 'Encryption',
    'composeMessage.deliveryNetworkLabel': 'Delivery network',
    'composeMessage.sendMessage': 'Send message',
    'composeMessage.preparingReview': 'Preparing review…',

    // Encryption choices.
    'composeMessage.eciesLabel': 'Standard (ECIES)',
    'composeMessage.eciesNote': 'Only the recipient can read it',
    'composeMessage.ecdhLabel': 'Shared key (ECDH)',
    'composeMessage.ecdhNote': 'You and the recipient can read it',
    'composeMessage.plainLabel': 'Plain text',
    'composeMessage.plainNote': 'Anyone can read it',

    // Plain-text confirmation and recipient key status.
    'composeMessage.plainConfirm': 'Send this message as plain text? Anyone can read it on the blockchain.',
    'composeMessage.sendAsPlain': 'Send as plain text',
    'composeMessage.keepEncrypted': 'Keep encrypted',
    'composeMessage.keyMissing': 'We don\'t know the recipient\'s public key yet, so we can\'t encrypt. They need to send a transaction first, or pick "Plain text" below.',
    'composeMessage.requestSession': 'Request encrypted session (publish your key)',
    'composeMessage.keyRequestSent': 'Key request sent. Once they respond or send any transaction, you can message them encrypted.',
    'composeMessage.keyLookingUp': 'Looking up recipient\'s public key…',
    'composeMessage.keyFound': '✓ Recipient public key found.',
    'composeMessage.keyUnavailable': 'The recipient\'s encryption key is no longer available. Refresh and try again.',
    'composeMessage.keyCheckFailed': 'Couldn\'t check the recipient\'s encryption key. Check your connection and try again.',
    'composeMessage.keyRequestFailed': 'Couldn\'t send the key request. Check your connection and try again.',
    'composeMessage.unstoredPassphrase': 'This wallet uses a 25th-word passphrase that hasn\'t been stored yet, so the key request can\'t be signed. Lock the wallet; the unlock screen will capture it, or pick "Plain text" below to message them without encryption.',

    // Validation and failure messages.
    'composeMessage.noAddresses': 'No addresses yet. Use Receive to generate one before sending.',
    'composeMessage.loadFailed': 'Failed to load addresses.',
    'composeMessage.noSigningAddress': 'No signing address is available on this delivery network.',
    'composeMessage.enterRecipient': 'Enter a recipient address.',
    'composeMessage.enterMessage': 'Write a message to send, or attach a file.',
    'composeMessage.invalidAddress': 'Enter a valid address',
    'composeMessage.incorrectPassword': 'Incorrect password.',
    'composeMessage.sendFailed': 'Send failed.',

    // Message size and attachments.
    'composeMessage.subjectPlain': 'Message is',
    'composeMessage.subjectPlainAttachment': 'Message and attachment are',
    'composeMessage.subjectEncrypted': 'Encrypted message is',
    'composeMessage.subjectEncryptedAttachment': 'Encrypted message and attachment are',
    'composeMessage.tooLong': '{subject} {bytes} bytes; the network accepts at most {max} bytes.',
    'composeMessage.byteCountPlain': '{bytes} / {max} bytes.',
    'composeMessage.byteCountEncrypted': '{bytes} / {max} encrypted bytes.',
    'composeMessage.attachmentHint': 'PNG, JPEG, GIF, WebP, PDF, or plain text, up to {max} bytes.',
    'composeMessage.attachmentUnsupported': 'Unsupported attachment type. Choose a PNG, JPEG, GIF, WebP, PDF, or plain-text file.',
    'composeMessage.attachmentEmpty': 'That attachment is empty.',
    'composeMessage.attachmentTooLarge': 'That attachment is {size} bytes. Attachments can be at most {max} bytes.',
    'composeMessage.attachmentUnreadable': 'Couldn\'t read that attachment.',
    'composeMessage.whatKeyRequest': 'key request',
    'composeMessage.whatMessage': 'message',
    'composeMessage.attached': 'Attached: {name} ({size} bytes)',

    // Review and result screens.
    'composeMessage.reviewSummary': 'Send {kind, select, plain {an unencrypted} other {an encrypted}} message to this recipient.',
    'composeMessage.confirmSend': 'Confirm send',
    'composeMessage.attachmentOnly': '(attachment only)',
    'composeMessage.feeSummary': 'Network fee: {amount}',
};

addEnglish(messages);

export default messages;
