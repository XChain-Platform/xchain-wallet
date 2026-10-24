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
    'multisig.share.title': 'Share this wallet as a cosigner',
    'multisig.share.instructions':
        'Give these values to the person creating the multisig. In their wallet they add a cosigner with origin "External xpub" and paste each one into the field of the same name. They are public keys: they show the shared address but can\'t spend from it.',
    'multisig.share.availability':
        'Only addresses from a software wallet can be shared here. A watch-only wallet has no signing key, and a hardware wallet must export this information from the device or its companion app.',
    'multisig.share.address': 'Address to share',
    'multisig.share.selectAddress': 'Select address',
    'multisig.share.payload': 'Share payload',
    'multisig.share.payloadHint': 'The QR code and text contain the same public cosigner fields.',
    'multisig.share.qrAlt': 'QR code for multisig cosigner share payload',
    'multisig.share.copyPayload': 'Copy cosigner share payload',
    'multisig.share.xpub': 'xpub',
    'multisig.share.account': 'Account {path}',
    'multisig.share.publicKey': 'Public key',
    'multisig.share.masterFingerprint': 'Master fingerprint',
    'multisig.share.derivationPath': 'Derivation path',
    'multisig.share.identityCheck':
        'Identity check: before funding the multisig, compare the master fingerprint and derivation path with the cosigner over a separate trusted channel. For a hardware signer, confirm its fingerprint on the device itself.',
    'multisig.share.copyField': 'Copy {label}',
    'multisig.share.unavailable': 'Not available from this signer',
};

addEnglish(messages);

export default messages;
