// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `verifySignature.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- signature verification ---------------------------------
    'verifySignature.title': 'Verify signature',
    'verifySignature.valid': 'Valid signature. Signature matches this message and address.',
    'verifySignature.invalid': "Invalid signature. Signature doesn't match this message and address.",
    'verifySignature.malformed': 'Malformed signature. Enter a base64-encoded signature.',
    'verifySignature.address': 'Address',
    'verifySignature.addressPlaceholder': 'The address that produced the signature',
    'verifySignature.message': 'Message',
    'verifySignature.messagePlaceholder': 'The exact text that was signed',
    'verifySignature.signature': 'Signature',
    'verifySignature.signaturePlaceholder': 'Base64 signature blob',
    'verifySignature.verifying': 'Verifying…',
};

addEnglish(messages);

export default messages;
