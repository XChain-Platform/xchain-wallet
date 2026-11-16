// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { envelopeUnavailableReason } from './envelopeSelection.js';
import { multipartSupportFor } from './multipartSupport.js';

function invalidMethod() {
    const error = new TypeError('method must be taproot or standard');
    error.code = 'MULTIPART_METHOD_INVALID';
    return error;
}

export function multipartSupportForMethod({
    method, descriptor, addressRecord, addressType, isWatcherMode = false,
}) {
    if (method === 'standard') {
        return multipartSupportFor({
            taprootChain: false, addressRecord, addressType, isWatcherMode,
        });
    }
    if (method !== 'taproot') throw invalidMethod();

    const reason = envelopeUnavailableReason({
        descriptor, fromAddress: addressRecord, isWatcherMode,
    });
    if (reason !== null) return { supported: false, reason };
    return multipartSupportFor({
        taprootChain: true, addressRecord, addressType, isWatcherMode,
    });
}
