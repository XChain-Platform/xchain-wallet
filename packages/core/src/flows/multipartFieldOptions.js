// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const METHODS = ['taproot', 'standard'];

function invalid(field) {
    const error = new TypeError(`multipart field options: ${field} is invalid`);
    error.code = 'MULTIPART_FIELD_OPTIONS_INVALID';
    return error;
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isReason(value) {
    return typeof value === 'string' && value.length > 0;
}

function validatePair(field, value, validEntry) {
    if (!isRecord(value)) throw invalid(field);
    for (const method of METHODS) {
        if (!Object.hasOwn(value, method) || !validEntry(value[method])) {
            throw invalid(`${field}.${method}`);
        }
    }
}

function isSupport(value) {
    if (!isRecord(value)) return false;
    if (value.supported === true) return true;
    return value.supported === false && isReason(value.reason);
}

function option(overrides = {}) {
    return {
        reason: null,
        cap: null,
        multipart: false,
        pending: false,
        summary: null,
        fee: null,
        ...overrides,
    };
}

function methodOption(method, input) {
    const singleReason = input.singleReasons[method];
    if (singleReason !== null && singleReason !== 'tooLarge') {
        return option({ reason: singleReason });
    }
    if (input.singleFits[method]) return option();
    const methodSupport = input.support[method];
    if (!methodSupport.supported) return option({ reason: methodSupport.reason });
    if (input.quoteOptions === null) return option({ multipart: true, pending: true });

    const quoted = input.quoteOptions[method];
    if (quoted.single === true) return option();
    if (quoted.reason) return option({ reason: quoted.reason, cap: quoted.cap ?? null });
    if (quoted.summary) {
        return option({ multipart: true, summary: quoted.summary, fee: quoted.fee ?? null });
    }
    return option({ reason: singleReason ?? 'tooLarge' });
}

export function multipartFieldOptions({ singleReasons, singleFits, quoteOptions, support }) {
    validatePair('singleReasons', singleReasons, (value) => value === null || isReason(value));
    validatePair('singleFits', singleFits, (value) => typeof value === 'boolean');
    validatePair('support', support, isSupport);
    if (quoteOptions !== null) validatePair('quoteOptions', quoteOptions, isRecord);

    const input = { singleReasons, singleFits, quoteOptions, support };
    const options = {
        taproot: methodOption('taproot', input),
        standard: methodOption('standard', input),
    };
    const reasons = {
        taproot: options.taproot.reason,
        standard: options.standard.reason,
    };
    return { options, reasons, ready: METHODS.every((method) => !options[method].pending) };
}
