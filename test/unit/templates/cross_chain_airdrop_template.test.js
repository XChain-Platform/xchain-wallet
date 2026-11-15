// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import template from '../../../packages/core/src/templates/cross-chain/cross-chain-airdrop.json';
import { validateCrossChainTemplate } from '../../../packages/core/src/templates/cross-chain/validate.js';

describe('cross-chain airdrop template', () => {
    it('is valid and defines one airdrop for every chain hint', () => {
        expect(validateCrossChainTemplate(template)).toEqual({ ok: true });
        expect(template.id).toBe('cross-chain-airdrop');
        expect(template.actions.map(({ chainHint }) => chainHint)).toEqual([
            'primary',
            'secondary',
            'tertiary',
        ]);
        expect(template.actions.every(({ action }) => action === 'AIRDROP')).toBe(true);
    });

    it('keeps shared token inputs while separating recipient-list references', () => {
        expect(template.actions.map(({ params }) => [
            params.VERSION,
            params.TICK,
            params.AMOUNT,
        ])).toEqual([
            ['0', 'MYTOKEN', '<amount per recipient>'],
            ['0', 'MYTOKEN', '<amount per recipient>'],
            ['0', 'MYTOKEN', '<amount per recipient>'],
        ]);
        expect(template.actions.map(({ params }) => params.LIST_ACTION_INDEX)).toEqual([
            '<LIST action_index for chain A recipients>',
            '<LIST action_index for chain B recipients>',
            '<LIST action_index for chain C recipients>',
        ]);
    });
});
