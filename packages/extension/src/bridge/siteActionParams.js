// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const REFUSED_FIELDS = ['legs', 'prebuiltPsbt', 'utxos', 'customOutputs', 'encoding'];
const DROPPED_FIELDS = new Set(['fee', 'feePerKb', 'rbf']);

export function screenSiteActionParams(params) {
    if (params === null || typeof params !== 'object') {
        return { ok: false, code: 'INVALID_PARAMS', fields: [] };
    }

    const fields = REFUSED_FIELDS.filter((field) => field in params);
    if (fields.length > 0) {
        return { ok: false, code: 'INVALID_PARAMS', fields };
    }

    const screened = Object.create(null);
    for (const key of Reflect.ownKeys(params)) {
        if (Object.prototype.propertyIsEnumerable.call(params, key)
            && !DROPPED_FIELDS.has(key)) {
            screened[key] = params[key];
        }
    }

    return { ok: true, params: screened };
}
