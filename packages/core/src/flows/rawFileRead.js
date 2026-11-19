// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const NOT_READY = Object.freeze({
    409: 'FILE_INCOMPLETE',
    422: 'FILE_ASSEMBLY_MISMATCH',
});

function bodyCode(body) {
    if (body == null) return null;
    let parsed = body;
    if (Buffer.isBuffer(body) || ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
        try { parsed = JSON.parse(Buffer.from(body).toString('utf8')); }
        catch (_err) { return null; }
    } else if (typeof body === 'string') {
        try { parsed = JSON.parse(body); }
        catch (_err) { return body; }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed.code || parsed.error?.code || null;
}

function errorStatus(err) {
    const value = err?.status ?? err?.response?.status ?? err?.details?.status;
    const status = Number(value);
    return Number.isInteger(status) ? status : null;
}

function errorBodyCode(err) {
    const bodies = [err?.details?.data, err?.response?.data, err?.body, err?.data];
    for (const body of bodies) {
        const code = bodyCode(body);
        if (code) return code;
    }
    return Object.values(NOT_READY).includes(err?.code) ? err.code : null;
}

/**
 * Convert a raw-route failure into a normal file state, or null when the
 * failure is not a route state that callers may safely absorb.
 *
 * @param {unknown} err
 * @returns {{state:'not_ready', reason:string, status:number}|{state:'missing'}|null}
 */
export function classifyRawError(err) {
    const status = errorStatus(err);
    const code = errorBodyCode(err);
    if (status === 404) return { state: 'missing' };
    if (NOT_READY[status]) {
        return { state: 'not_ready', reason: NOT_READY[status], status };
    }
    const codeStatus = code === NOT_READY[409] ? 409
        : code === NOT_READY[422] ? 422 : null;
    return codeStatus
        ? { state: 'not_ready', reason: code, status: codeStatus }
        : null;
}

/**
 * Read the explorer raw route and preserve incomplete, mismatch and missing
 * as explicit states so callers never mistake an empty response for a file.
 *
 * @param {any} sdk
 * @param {number|string} actionIndex
 * @param {string|null} [coin]
 */
export async function readRawFile(sdk, actionIndex, coin = null) {
    let value;
    try {
        value = await sdk.getGatedFileRaw(actionIndex, coin);
    } catch (err) {
        const classified = classifyRawError(err);
        if (classified) return classified;
        throw err;
    }
    if (value == null) return { state: 'missing' };
    const bytes = Buffer.from(value);
    return bytes.length === 0 ? { state: 'missing' } : { state: 'ready', bytes };
}
