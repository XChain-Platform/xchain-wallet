// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { gateMinAmountValidationError } from './gatedPublishAction.js';

const KEY_HASH = /^[0-9a-f]{64}$/;

function invalid(field, reason) {
    const error = new TypeError(`Invalid gated multipart start field: ${field}`);
    error.code = 'GATED_MULTIPART_FIELDS_INVALID';
    error.field = field;
    if (reason !== undefined) error.reason = reason;
    throw error;
}

export function gatedMultipartStartFields(args = {}) {
    const {
        gateTicker, thresholdActive, gateMinAmount, packChoice,
    } = args ?? {};
    if (typeof gateTicker !== 'string' || gateTicker.trim().length === 0) {
        invalid('gateTicker');
    }
    if (typeof thresholdActive !== 'boolean') invalid('thresholdActive');
    if (typeof gateMinAmount !== 'string') invalid('gateMinAmount');
    if (packChoice !== 'new'
        && (typeof packChoice !== 'string' || !KEY_HASH.test(packChoice))) {
        invalid('packChoice');
    }

    const minAmount = thresholdActive ? gateMinAmount.trim() : '';
    if (minAmount) {
        const reason = gateMinAmountValidationError(minAmount);
        if (reason) invalid('gateMinAmount', reason);
    }

    return {
        gate: { ticker: gateTicker.trim(), minAmount },
        ...(packChoice !== 'new' ? { existingKeyHash: packChoice } : {}),
    };
}
