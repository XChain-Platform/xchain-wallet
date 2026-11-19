// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { declaresDeflateRaw, fileCompressionFieldOf } from './payloadCompression.js';
import { GATED_MULTIPART_MAX_BYTES } from './fileSizeLimits.js';

const ACTION_STRING_KEYS = ['tx_data', 'action_string', 'actionString', 'raw_action'];

function fileVersionOf(candidate) {
    if (typeof candidate !== 'string' || candidate.length === 0) return '';
    const parts = candidate.split('|');
    return String(parts[0]).toUpperCase() === 'FILE' ? String(parts[1]) : '';
}

function inspectAction(action) {
    if (!action || typeof action !== 'object') return { declared: '', versionZero: false };
    const record = action.data && typeof action.data === 'object' ? action.data : action;
    let declared = '';
    let versionZero = false;
    for (const key of ACTION_STRING_KEYS) {
        const candidate = record[key] ?? action[key];
        if (typeof candidate !== 'string' || candidate.length === 0) continue;
        if (fileVersionOf(candidate) === '0') versionZero = true;
        if (declared.length === 0) declared = fileCompressionFieldOf(candidate);
    }
    const parsed = record.COMPRESSION ?? record.compression;
    if (declared.length === 0 && parsed !== undefined && parsed !== null) {
        declared = String(parsed);
    }
    return { declared, versionZero };
}

function cappedOptions() {
    return { maxOutputBytes: GATED_MULTIPART_MAX_BYTES };
}

/**
 * Resolve the gated compression declaration and its version-aware inflate cap.
 * Never throws and never probes an action more than once.
 *
 * @param {{ sdk: any, actionIndex: string|number, declared?: string|null }} params
 * @returns {Promise<{declared: string, options: {maxOutputBytes?: number}}>}
 */
export async function resolveGatedInflate(params) {
    const { sdk, actionIndex, declared = null } = params;
    const supplied = typeof declared === 'string' && declared.length > 0 ? declared : '';
    if (supplied && !declaresDeflateRaw(supplied)) return { declared: supplied, options: {} };
    const actionSupplied = Object.hasOwn(params, 'action');
    if (!actionSupplied && (!sdk || typeof sdk.getAction !== 'function')) {
        return { declared: supplied, options: cappedOptions() };
    }
    try {
        const action = actionSupplied
            ? params.action
            : await sdk.getAction(String(actionIndex));
        const inspected = inspectAction(action);
        return {
            declared: supplied || inspected.declared,
            options: inspected.versionZero ? {} : cappedOptions(),
        };
    } catch {
        return { declared: supplied, options: cappedOptions() };
    }
}
