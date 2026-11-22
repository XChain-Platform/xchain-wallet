// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const LOGIN_PROOF_LIMIT = 5;

export function selectLoginAddresses(requested, granted) {
    const allowed = granted === null
        ? null
        : new Set(Array.isArray(granted?.permissions?.addresses) ? granted.permissions.addresses : []);
    const qualified = [];
    const seen = new Set();

    for (const address of Array.isArray(requested) ? requested : []) {
        if (typeof address !== 'string' || seen.has(address)) continue;
        seen.add(address);
        if (allowed === null || allowed.has(address)) qualified.push(address);
    }

    return {
        addresses: qualified.slice(0, LOGIN_PROOF_LIMIT),
        truncated: qualified.length > LOGIN_PROOF_LIMIT,
    };
}
