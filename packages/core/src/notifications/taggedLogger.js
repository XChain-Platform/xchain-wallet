// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };
const SAFE_ERROR_TYPES = new Set([
    'Error',
    'EvalError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'TypeError',
    'URIError',
]);

function safeErrorType(value) {
    if (!value || typeof value !== 'object') return null;
    const name = typeof value.name === 'string' && SAFE_ERROR_TYPES.has(value.name)
        ? value.name
        : 'Error';
    return `<${name}>`;
}

/**
 * Preserve a caller-provided log sink while keeping notification diagnostics
 * tagged and free of exception messages, stacks, and response payloads.
 *
 * @param {{ debug?: Function, warn?: Function, error?: Function } | null | undefined} logger
 * @param {string} tag
 */
export function taggedLogger(logger, tag) {
    const sink = logger || NOOP_LOGGER;
    const prefix = `[${tag}]`;
    const emit = (level, message, detail) => {
        const write = typeof sink[level] === 'function' ? sink[level].bind(sink) : null;
        if (!write) return;
        const text = typeof message === 'string' ? message : 'diagnostic event';
        const errorType = safeErrorType(detail);
        if (errorType) write(`${prefix} ${text}`, errorType);
        else write(`${prefix} ${text}`);
    };
    return {
        debug: (message, detail) => emit('debug', message, detail),
        warn: (message, detail) => emit('warn', message, detail),
        error: (message, detail) => emit('error', message, detail),
    };
}
