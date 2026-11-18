// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isDeviceAddressSource } from '../schemas/constants.js';
import { signerSupportsTapscript } from './signerCapability.js';

const MULTIPART_FILE_MAX_BYTES = 262_140_000_000;
const ENVELOPE_ONE_CALL_TYPES = new Set(['p2wpkh', 'p2tr']);
const STANDARD_ONE_CALL_TYPES = new Set(['p2pkh', 'p2wpkh', 'p2sh-p2wpkh']);

export function multipartSupportFor({
    taprootChain, addressRecord, addressType, isWatcherMode,
}) {
    if (typeof taprootChain !== 'boolean') {
        throw new TypeError('taprootChain must be a boolean');
    }
    if (isWatcherMode === true) return { supported: false, reason: 'watcher' };

    const source = addressRecord?.source;
    if (isDeviceAddressSource(source)) {
        return { supported: false, reason: 'hardware' };
    }
    if (source === 'watch-only') return { supported: false, reason: 'watchOnly' };
    if (!signerSupportsTapscript(addressRecord)) {
        return { supported: false, reason: 'signer' };
    }

    if (taprootChain) {
        const buildMode = ENVELOPE_ONE_CALL_TYPES.has(addressType) ? 'one_call' : 'two_step';
        return { supported: true, lane: 'envelope', buildMode };
    }

    if (addressType === 'p2tr') return { supported: false, reason: 'sourceType' };
    const buildMode = STANDARD_ONE_CALL_TYPES.has(addressType) ? 'one_call' : 'sourceType';
    return { supported: true, lane: 'standard', buildMode };
}

export function maxUploadBytesFor(support, singleTransactionCap) {
    if (!Number.isSafeInteger(singleTransactionCap) || singleTransactionCap <= 0) {
        throw new TypeError('singleTransactionCap must be a positive safe integer');
    }
    return support.supported ? MULTIPART_FILE_MAX_BYTES : singleTransactionCap;
}
