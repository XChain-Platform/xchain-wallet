// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `multisig.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'multisig.create.invalidSharedAccountPath': 'Shared cosigner setup contains an invalid account path.',
    'multisig.create.invalidAccountPath': '{tag}: enter a valid account path starting with m.',
    'multisig.create.accountPathHelp': "Enter the account path for the cosigner's key.",
    'multisig.create.accountPathDepthMismatch': 'Account path does not match the account public key depth.',
    'multisig.create.accountPathChildMismatch': 'Account path does not match the account public key child index.',
    'multisig.create.accountPathHardenedChild': 'Account path asks this account public key to derive a hardened child.',
    'multisig.create.publicKeyMismatch': 'Public key does not match the account public key and account path.',
    'multisig.create.accountPathDeriveFailed': 'Account path cannot be derived from this account public key.',
    'multisig.share.title': 'Share Wallet as Cosigner',
    'multisig.share.noticeTitle': 'Share Public Keys',
    'multisig.share.instructions':
        'Give these values to the person creating the multisig. In their wallet they add a cosigner with origin "Another wallet" and paste each one into the field of the same name. They are public keys: they show the shared address but can\'t spend from it.',
    'multisig.share.availability':
        'Only addresses from a software wallet can be shared here. An address with no key in this wallet can\'t be shared, and a hardware wallet must export this information from the device or its companion app.',
    'multisig.share.address': 'Address to share',
    'multisig.share.addressHelp': 'The address whose public key you give the multisig creator. Its key joins the shared wallet, and this address keeps its own funds.',
    'multisig.share.selectAddress': 'Select address',
    'multisig.share.chooseAddress': 'Choose address to share',
    'multisig.share.button': 'Share',
    'multisig.share.watchOnlyUnavailable': 'No key, unavailable',
    'multisig.share.hardwareUnavailable': 'Hardware, export on device',
    'multisig.share.importedUnavailable': 'Imported key, unavailable',
    'multisig.share.payload': 'Share details',
    'multisig.share.payloadHint': 'The QR code and text contain the same public cosigner fields.',
    'multisig.share.qrAlt': 'QR code for multisig cosigner share details',
    'multisig.share.copyPayload': 'Copy Cosigner Share Details',
    'multisig.share.xpub': 'Account public key',
    'multisig.share.account': 'Account {path}',
    'multisig.overCeilingNotice':
        "This multisig has more cosigners than its address type supports, so funds sent to it can't be spent.",
    'multisig.share.publicKey': 'Public key',
    'multisig.share.masterFingerprint': 'Master fingerprint',
    'multisig.share.derivationPath': 'Account path',
    'multisig.share.identityCheck':
        'Identity check: before funding the multisig, compare the master fingerprint and account path shown above with the cosigner over a separate trusted channel. For a hardware wallet, confirm its fingerprint on the device itself.',
    'multisig.share.copyField': 'Copy {label}',
    'multisig.share.unavailable': 'Not available from this address',
    'multisig.reply.signatureInvalid':
        "This cosigner reply's signature doesn't match this signing session, so it doesn't count. Ask the cosigner to sign this session's request again and send the new reply.",
    'multisig.reply.nonceInvalid':
        "This cosigner's step 1 reply isn't a valid response for this signing session, so it doesn't count. Ask the cosigner to load this session's request again and send the new reply.",
    'multisig.reply.nonceRepeated':
        "This step 1 reply is identical to one already counted for another cosigner, so it doesn't count. One of the two replies isn't genuine. If this session can't collect a reply from every cosigner, cancel it and start a new signing session.",
    'multisig.finalize.conflict':
        'This signing session was already finalized with a different transaction. The saved transaction was not changed.',
    'multisig.signingLink.label': 'Signing link',
    'multisig.signingLink.labelHelp': 'A link that carries this signing request. Send it to a cosigner, whose wallet opens it to review and sign.',
    'multisig.signingLink.share': 'Share',
    'multisig.signingLink.copied': 'Signing link copied.',
    'multisig.signingLink.copyFailed': 'The signing link couldn\'t be copied.',
    'multisig.signingLink.shareTitle': 'Multisig signing request',
    'multisig.signingLink.shareText': 'Open this link in XChain Wallet to review and sign the multisig transaction.',
    'multisig.signingLink.shareFailed': 'The signing link couldn\'t be shared.',
    'multisig.signingLink.openTitle': 'Open a signing link',
    'multisig.signingLink.openHint': 'Paste a signing link from the wallet coordinating this transaction.',
    'multisig.signingLink.openLabel': 'Signing link to open',
    'multisig.signingLink.open': 'Open Signing Link',
    'multisig.signingLink.required': 'Paste or scan a signing link to open.',
    'multisig.signingLink.openFailed': 'This signing link couldn\'t be opened.',
    'multisig.signingLink.invalid': 'This isn\'t a valid multisig signing link.',
    'multisig.signingLink.missingRequest': 'This signing link doesn\'t contain a signing request.',
    'multisig.signingLink.tooLarge': 'This signing link is too large to open safely.',
    'multisig.signingLink.badEncoding': 'This signing link contains invalid encoded data.',
    'multisig.signingLink.badRequest': 'This signing link contains an invalid signing request.',
    'multisig.signingLink.requestOnly': 'This link isn\'t a multisig signing request.',
    'multisig.signingLink.scan': 'Scan a signing link',
    'multisig.signingLink.stopScan': 'Stop scanner',
    'multisig.sessions.listLabel': 'Multisig sessions',
    'multisig.sessions.tabsLabel': 'Session views',
    'multisig.sessions.tabReady': 'Ready',
    'multisig.sessions.tabWaiting': 'Waiting',
    'multisig.sessions.tabDone': 'Done',
    'multisig.sessions.emptyReadyTitle': 'Nothing to sign or send',
    'multisig.sessions.emptyReadyBody': 'Sessions that need your signature, or are signed and ready to send, appear here.',
    'multisig.sessions.emptyWaitingTitle': 'Not waiting on anyone',
    'multisig.sessions.emptyWaitingBody': 'Sessions waiting on other cosigners to sign appear here.',
    'multisig.sessions.emptyDoneTitle': 'No finished sessions',
    'multisig.sessions.emptyDoneBody': 'Sent and cancelled sessions appear here.',
    'multisig.sessions.emptyTitle': 'No Signing Sessions',
    'multisig.sessions.emptyBody': 'Start one with the plus button, or open a signing link from a cosigner with the link button beside it.',
    'multisig.sessions.untitled': 'Multisig transaction',
    'multisig.sessions.type': '{threshold} of {count} {scheme}',
    'multisig.sessions.step': 'step {step} of 2',
    'multisig.sessions.pillSigned': '{current} of {threshold}',
    'multisig.sessions.pillSendNow': 'Send now',
    'multisig.sessions.pillReady': 'Ready',
    'multisig.sessions.pillSent': 'Sent',
    'multisig.sessions.pillCancelled': 'Cancelled',
    'multisig.start.button': 'Start a Signing Session',
    'multisig.start.pickMultisigTitle': 'Choose Multisig',
    'multisig.start.pickActionTitle': 'Choose Action',
    'multisig.start.sendTitle': 'Send from Multisig',
    'multisig.start.networkHelp': 'The network the multisig spends on.',
    'multisig.start.listLabel': 'Multisigs on this network',
    'multisig.start.loading': 'Loading multisigs…',
    'multisig.share.loadingWallet': 'Loading this wallet…',
    'multisig.start.loadFailed': 'Couldn\'t load this wallet\'s multisigs.',
    'multisig.start.emptyTitle': 'No Multisig Yet',
    'multisig.start.emptyBody': 'Create a multisig first, then start a signing session from it here.',
    'multisig.start.noAddress': 'Has more cosigners than its address type can spend from',
    'multisig.start.actionsLabel': 'Actions',
    'multisig.start.actionSend': 'Send',
    'multisig.start.actionSendHint': 'Pay coins from this multisig; cosigners sign before it goes out.',
    'multisig.import.taprootUnsupported': 'Taproot signing requests can\'t be opened from a link yet.',
    'multisig.import.transactionRequired': 'This signing request doesn\'t include a transaction to review.',
    'multisig.import.chainRequired': 'This signing request doesn\'t identify a supported Bitcoin network.',
    'multisig.send.needsSignatures': 'Needs {threshold} of {cosignerCount} signatures',
    'multisig.send.networkHelp': 'The network this multisig address belongs to; a multisig address lives on one network only.',
    'multisig.send.fromHelp': 'The shared multisig address the coins leave from, once enough cosigners have signed.',
    'multisig.send.toHelp': 'The address that receives the coins after enough cosigners sign.',
    'multisig.send.amountHelp': 'How many coins the recipient gets from the multisig address.',
};

addEnglish(messages);

export default messages;
