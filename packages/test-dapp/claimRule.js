// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

function equalClaim(left, right) {
    const length = Math.max(left.length, right.length);
    let difference = left.length ^ right.length;

    for (let index = 0; index < length; index += 1) {
        difference |= (left.charCodeAt(index) | 0) ^ (right.charCodeAt(index) | 0);
    }

    return difference === 0;
}

function isObject(value) {
    return value !== null && typeof value === 'object';
}

export function claimLogin(record, presented) {
    if (!isObject(record)) return { ok: false, reason: 'NO_RECORD' };

    try {
        if (record.body?.method !== 'login' || record.body.ok !== true) {
            return { ok: false, reason: 'NOT_A_LOGIN' };
        }
        if (record.claimed === true) return { ok: false, reason: 'ALREADY_CLAIMED' };

        const claimMatches = isObject(presented)
            && typeof presented.claim === 'string'
            && record.claim !== null
            && typeof record.claim === 'string'
            && equalClaim(presented.claim, record.claim);
        const presentedResult = isObject(presented) && isObject(presented.result)
            ? presented.result
            : null;
        const storedResult = isObject(record.body.result) ? record.body.result : null;
        const resultMatches = presentedResult !== null
            && storedResult !== null
            && typeof presentedResult.address === 'string'
            && typeof presentedResult.challenge === 'string'
            && typeof presentedResult.signature === 'string'
            && presentedResult.address === storedResult.address
            && presentedResult.challenge === storedResult.challenge
            && presentedResult.signature === storedResult.signature;

        if (!claimMatches && !resultMatches) return { ok: false, reason: 'NO_MATCH' };

        return {
            ok: true,
            address: record.verified.address,
            record: { ...record, claimed: true, status: 'approved' },
        };
    } catch {
        return { ok: false, reason: 'NO_MATCH' };
    }
}
