// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The co-signer matches each output to the first allow-list entry with its
// script, so a second row for one address saves a cap that is never enforced.
// The policy editor refuses the repeated address. Bech32 addresses compare
// without letter case; base58 addresses compare exactly.

import { describe, expect, it } from 'vitest';
import { buildPolicyDraft, emptyPolicyDraft } from '../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx';

const BASE58 = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const BECH32 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const OTHER_BECH32 = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

function draftWithOutputs(allowedOutputs) {
    return { ...emptyPolicyDraft(), allowedActionsText: 'SEND', allowedOutputs };
}

describe('co-signer allowed outputs refuse a repeated address', () => {
    it('refuses a repeated base58 address', () => {
        const built = buildPolicyDraft(draftWithOutputs([
            { address: BASE58, maxValue: '1000' },
            { address: BASE58, maxValue: '5' },
        ]));
        expect(built.error).toMatch(/listed more than once/);
        expect(built.policy).toBeUndefined();
    });

    it('refuses one bech32 address typed in two letter cases', () => {
        const built = buildPolicyDraft(draftWithOutputs([
            { address: BECH32, maxValue: '1000' },
            { address: BECH32.toUpperCase(), maxValue: '5' },
        ]));
        expect(built.error).toMatch(/listed more than once/);
        expect(built.policy).toBeUndefined();
    });

    it('keeps both rows for distinct addresses', () => {
        const built = buildPolicyDraft(draftWithOutputs([
            { address: BASE58, maxValue: '1000' },
            { address: OTHER_BECH32, maxValue: '5' },
        ]));
        expect(built.error).toBeUndefined();
        expect(built.allowedOutputs).toEqual([
            { address: BASE58, maxValue: 1000 },
            { address: OTHER_BECH32, maxValue: 5 },
        ]);
    });

    it('skips a blank row', () => {
        const built = buildPolicyDraft(draftWithOutputs([
            { address: BECH32, maxValue: '1000' },
            { address: '  ', maxValue: '' },
            { address: OTHER_BECH32, maxValue: '' },
        ]));
        expect(built.error).toBeUndefined();
        expect(built.allowedOutputs).toEqual([
            { address: BECH32, maxValue: 1000 },
            { address: OTHER_BECH32 },
        ]);
    });

    it('refuses a max value with no address', () => {
        const built = buildPolicyDraft(draftWithOutputs([{ address: '', maxValue: '1000' }]));
        expect(built.error).toBe('An allowed-output max value is missing its address.');
    });
});
