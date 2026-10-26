// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// How large an action with a trailing repeating field this wallet can sign.
//
// LIST v0, v1 and v4 end in `...ITEM`; DEPLOY v0 and v2 end in
// `...CONSTRUCTOR_PARAMS`. Up to the 8 KB compiled ceiling such an action rides
// a data carrier the wallet verifies byte for byte. Above it the encoder moves
// it into a Taproot envelope, and the SDK decoder the reveal check reads refuses
// a repeating field (REST_FIELD_UNSUPPORTED, or UNKNOWN_ACTION for LIST v4), so
// the wallet cannot verify what it would sign. On a chain or signer with no
// envelope the same action is refused at 8 KB anyway. So 8 KB compiled is the
// ceiling on every lane for these actions, and it is a BYTE limit: how many
// entries fit depends on how long they are.
//
// Pure (no React, no SDK) so forms and flows size an action without an SDK in
// hand. A unit test pins the string built here byte-equal to the SDK's own
// createAction for every supported action and version.

import { compiledPayloadByteLen } from './envelopeSelection.js';
import { MAX_COMPILED_ACTION_BYTES, pushPrefixSize } from './fileSizeLimits.js';

/** The compiled size, in bytes, above which this wallet cannot sign these actions. */
export const MAX_VERIFIABLE_ACTION_BYTES = MAX_COMPILED_ACTION_BYTES;

const utf8Len = (value) => new TextEncoder().encode(String(value)).length;
const text = (value) => (value === undefined || value === null ? '' : String(value));

function base64OfUtf8(source) {
    let binary = '';
    for (const byte of new TextEncoder().encode(String(source))) binary += String.fromCharCode(byte);
    return btoa(binary);
}

// Each supported format: the segments before the repeating tail, and the
// params key that carries the tail. Segment order is the SDK format table's.
const FORMATS = {
    'LIST 0': {
        tail: 'ITEM',
        head: (p) => ['LIST', '0', text(p.TYPE), text(p.MEMO)],
    },
    'LIST 1': {
        tail: 'ITEM',
        head: (p) => ['LIST', '1', text(p.EDIT), text(p.LIST_ACTION_INDEX), text(p.MEMO)],
    },
    'LIST 4': {
        tail: 'ITEM',
        head: (p) => ['LIST', '4', text(p.TYPE), text(p.NAME), text(p.DESCRIPTION), text(p.MEMO)],
    },
    'DEPLOY 0': {
        tail: 'CONSTRUCTOR_PARAMS',
        // The SDK base64-encodes CODE into the CODE_ENCODING slot.
        head: (p) => ['DEPLOY', '0',
            p.CODE_ENCODING !== undefined ? text(p.CODE_ENCODING) : base64OfUtf8(text(p.CODE)),
            text(p.GAS_LIMIT)],
    },
    'DEPLOY 2': {
        tail: 'CONSTRUCTOR_PARAMS',
        head: (p) => ['DEPLOY', '2', text(p.CODE_HASH), text(p.GAS_LIMIT)],
    },
};

function formatFor(action, params) {
    const spec = FORMATS[`${action} ${text(params?.VERSION)}`];
    if (!spec) throw new Error(`Unsupported size-check format: ${action} v${text(params?.VERSION) || 'missing'}`);
    return spec;
}

function tailOf(spec, params) {
    const tail = params?.[spec.tail];
    if (tail === undefined || tail === null) return [];
    return (Array.isArray(tail) ? tail : [tail]).map(String);
}

/** Whether this action and version end in a repeating field the sizer covers. */
export function hasVariadicTail(action, params) {
    return Object.prototype.hasOwnProperty.call(FORMATS, `${action} ${text(params?.VERSION)}`);
}

/**
 * The action string the SDK serializes for these params, trailing empty
 * segments trimmed the way its serializer trims them.
 *
 * @param {string} action   'LIST' or 'DEPLOY'
 * @param {Record<string, string | string[]>} params
 * @returns {string}
 */
export function variadicActionString(action, params) {
    const spec = formatFor(action, params);
    const segments = [...spec.head(params), ...tailOf(spec, params)];
    while (segments.length > 0 && segments[segments.length - 1] === '') segments.pop();
    return segments.join('|');
}

/**
 * Compiled size of the action, as the confirm lane sizes it.
 *
 * @param {string} action
 * @param {Record<string, string | string[]>} params
 * @returns {number}
 */
export function variadicActionBytes(action, params) {
    return compiledPayloadByteLen(variadicActionString(action, params), null, null);
}

/**
 * Size verdict for one action: its compiled bytes, whether it fits the
 * verifiable ceiling, and how many of its repeating entries, taken in order,
 * would fit.
 *
 * @param {string} action
 * @param {Record<string, string | string[]>} params
 * @returns {{ action: string, version: string, bytes: number, maxBytes: number, fits: boolean, given: number, fit: number, tail: string }}
 */
export function variadicActionFit(action, params) {
    const spec = formatFor(action, params);
    const entries = tailOf(spec, params);
    const bytes = variadicActionBytes(action, params);
    // Walk string lengths rather than rebuilding every prefix, so a pasted list
    // of thousands stays linear: each entry adds its own bytes plus a separator.
    // The push prefix only grows with the total, so the first prefix over the
    // ceiling ends the walk.
    let stringBytes = utf8Len(spec.head(params).join('|'));
    let fit = 0;
    for (const entry of entries) {
        stringBytes += 1 + utf8Len(entry);
        if (stringBytes + pushPrefixSize(stringBytes) > MAX_VERIFIABLE_ACTION_BYTES) break;
        fit += 1;
    }
    return {
        action,
        version: text(params.VERSION),
        bytes,
        maxBytes: MAX_VERIFIABLE_ACTION_BYTES,
        fits: bytes <= MAX_VERIFIABLE_ACTION_BYTES,
        given: entries.length,
        fit,
        tail: spec.tail,
    };
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const plural = (n, noun) => (n === 1 ? noun.singular : noun.plural);

/**
 * The plain refusal for an action too large to verify, or null when it fits.
 * Names the limit, how many entries fit and how many were given.
 *
 * @param {ReturnType<typeof variadicActionFit>} fit
 * @param {{ subject?: string, singular?: string, plural?: string }} [words]
 *   what to call the action and its entries ('This list', 'address', 'addresses')
 * @returns {string|null}
 */
export function variadicSizeMessage(fit, words = {}) {
    if (fit.fits) return null;
    const subject = words.subject || 'This action';
    const noun = { singular: words.singular || 'entry', plural: words.plural || 'entries' };
    const limit = `${fmt(fit.maxBytes)} bytes`;
    if (fit.fit === 0) {
        return `${subject} is ${fmt(fit.bytes)} bytes, over the ${limit} one action can hold, `
            + `and not even one ${noun.singular} fits. Shorten its text or remove entries.`;
    }
    const over = fit.given - fit.fit;
    return `${subject} has ${fmt(fit.given)} ${plural(fit.given, noun)} (${fmt(fit.bytes)} bytes), `
        + `but one action holds ${limit}, which fits ${fmt(fit.fit)} of them. `
        + `Remove ${fmt(over)} ${plural(over, noun)}.`;
}

/**
 * Size verdict for the DEPLOY a contract with these constructor arguments
 * needs: the inline DEPLOY v0 when the source fits one action, else the
 * assembling DEPLOY v2 that follows the source's chunk carriers (its CODE_HASH
 * is always 64 hex characters, so a placeholder sizes it exactly). The chunk
 * carriers hold only source, so the arguments decide whether the assembler can
 * be verified. A stakeable deploy (v1, v3) carries one plain argument field
 * and is not sized here.
 *
 * @param {{ code: string, gasLimit: string|number, constructorParams?: string[] }} args
 * @returns {ReturnType<typeof variadicActionFit>}
 */
export function deployActionFit({ code, gasLimit, constructorParams }) {
    const inline = variadicActionFit('DEPLOY', {
        VERSION: '0', CODE: code, GAS_LIMIT: String(gasLimit ?? ''), CONSTRUCTOR_PARAMS: constructorParams,
    });
    if (inline.fits) return inline;
    return variadicActionFit('DEPLOY', {
        VERSION: '2', CODE_HASH: '0'.repeat(64), GAS_LIMIT: String(gasLimit ?? ''), CONSTRUCTOR_PARAMS: constructorParams,
    });
}

/** How a deploy's constructor arguments are named in a size refusal. */
export const DEPLOY_ARGUMENT_WORDS = { subject: 'This deploy', singular: 'argument', plural: 'arguments' };
