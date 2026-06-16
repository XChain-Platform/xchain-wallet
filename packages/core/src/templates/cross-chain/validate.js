// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cross-chain template validator — §42.8.4. Pure function, no I/O.
// Lives in its own file so Node-level smokes can validate the
// bundled JSON files via `fs` without importing index.js (which
// uses Vite's JSON-import path).

/** @typedef {Object} CrossChainTemplateAction
 *  @property {'primary' | 'secondary' | 'tertiary'} chainHint
 *  @property {string} action
 *  @property {Record<string, string>} params
 *  @property {string} [note]
 */

/** @typedef {Object} CrossChainTemplate
 *  @property {string} id
 *  @property {string} name
 *  @property {string} description
 *  @property {string[]} [personas]
 *  @property {CrossChainTemplateAction[]} actions
 */

/**
 * @param {unknown} t
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateCrossChainTemplate(t) {
    const errors = [];
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
        return { ok: false, errors: ['template must be an object'] };
    }
    const tt = /** @type {Record<string, unknown>} */ (t);
    if (typeof tt.id !== 'string' || tt.id.length === 0) errors.push('id must be a non-empty string');
    if (typeof tt.name !== 'string' || tt.name.length === 0) errors.push('name must be a non-empty string');
    if (typeof tt.description !== 'string' || tt.description.length === 0) errors.push('description must be a non-empty string');
    if (!Array.isArray(tt.actions) || tt.actions.length === 0) {
        errors.push('actions must be a non-empty array');
    } else {
        tt.actions.forEach((row, i) => {
            if (!row || typeof row !== 'object' || Array.isArray(row)) {
                errors.push(`actions[${i}]: must be an object`);
                return;
            }
            const r = /** @type {Record<string, unknown>} */ (row);
            if (!['primary', 'secondary', 'tertiary'].includes(/** @type {string} */ (r.chainHint))) {
                errors.push(`actions[${i}].chainHint: must be 'primary' | 'secondary' | 'tertiary'`);
            }
            if (typeof r.action !== 'string' || /** @type {string} */ (r.action).length === 0) {
                errors.push(`actions[${i}].action: must be a non-empty string`);
            }
            if (!r.params || typeof r.params !== 'object' || Array.isArray(r.params)) {
                errors.push(`actions[${i}].params: must be an object`);
            }
        });
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
