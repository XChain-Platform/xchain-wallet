// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// G127: the contract call Confirm facts card names the contract and method.
import { describe, expect, it } from 'vitest';
import { registerLocale } from '../../../packages/core/src/i18n/index.js';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';
import { contractCallFacts } from '../../../packages/core/src/shared/routes/contractCallFacts.js';

registerLocale('en', en);

describe('contractCallFacts', () => {
    it('names the contract number, its name when known, and the method', () => {
        const facts = contractCallFacts({ index: '4242', row: { meta_name: 'E2E Escrow' }, method: 'release' });
        expect(facts).toEqual([
            { label: 'Contract', value: '#4242' },
            { label: 'Contract name', value: 'E2E Escrow' },
            { label: 'Method', value: 'release' },
        ]);
    });

    it('leaves out the name when the contract exported none and the method before one is chosen', () => {
        expect(contractCallFacts({ index: '7', row: null, method: '' })).toEqual([
            { label: 'Contract', value: '#7' },
        ]);
    });
});
