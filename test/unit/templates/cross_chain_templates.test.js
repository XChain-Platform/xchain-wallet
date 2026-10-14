// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateCrossChainTemplate } from '../../../packages/core/src/templates/cross-chain/validate.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const templateDir = fileURLToPath(
    new URL('../../../packages/core/src/templates/cross-chain/', import.meta.url),
);
const templates = readdirSync(templateDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(new URL(name, `file://${templateDir}/`), 'utf8')));
const sdk = new XChainSDK({
    network: 'bitcoin-regtest',
    preflight: false,
    compactTickers: false,
    compactAddresses: false,
});

const PLACEHOLDER_VALUES = {
    AMOUNT: '25',
    COIN1_ACTION_INDEX: '101',
    COIN2_ACTION_INDEX: '102',
    LIST_ACTION_INDEX: '103',
};

function fillPlaceholders(params) {
    return Object.fromEntries(Object.entries(params).map(([field, value]) => {
        if (typeof value !== 'string' || !value.startsWith('<')) return [field, value];
        const sample = PLACEHOLDER_VALUES[field];
        if (!sample) throw new Error(`No sample value for placeholder ${field}: ${value}`);
        return [field, sample];
    }));
}

const VALID_TEMPLATE = {
    id: 'valid-template',
    name: 'Valid template',
    description: 'A valid template',
    personas: ['Jin'],
    actions: [{
        chainHint: 'primary',
        action: 'SEND',
        params: { VERSION: '0' },
        note: 'Review before signing.',
    }],
};

describe('cross-chain template validation', () => {
    it.each([
        ['whitespace-only identity fields', { ...VALID_TEMPLATE, id: '  ' }],
        ['non-string personas', { ...VALID_TEMPLATE, personas: ['Jin', 7] }],
        ['non-string params', {
            ...VALID_TEMPLATE,
            actions: [{ ...VALID_TEMPLATE.actions[0], params: { VERSION: 0 } }],
        }],
        ['non-string notes', {
            ...VALID_TEMPLATE,
            actions: [{ ...VALID_TEMPLATE.actions[0], note: false }],
        }],
    ])('rejects %s', (_label, template) => {
        expect(validateCrossChainTemplate(template).ok).toBe(false);
    });
});

describe('bundled cross-chain templates', () => {
    for (const template of templates) {
        for (const [index, row] of template.actions.entries()) {
            it(`${template.id} row ${index + 1} serializes with the real SDK`, () => {
                const result = sdk.actions.createAction({
                    action: row.action,
                    params: fillPlaceholders(row.params),
                });

                expect(result.actionString).toMatch(new RegExp(`^${row.action}\\|`));
            });
        }
    }
});
