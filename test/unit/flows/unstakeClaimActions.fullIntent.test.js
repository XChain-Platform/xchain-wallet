// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An absent AMOUNT is the protocol's "everything" (COLLECT|0, a full
// UNSTAKE), so the composers accept it only on an explicit full request. A
// caller that meant an amount and lost it must fail before signing.
// Litecoin is used as the chain so a composer that passes the amount guard
// stops at the validator-lane gate, before any vault or signer is touched.

import { describe, it, expect } from 'vitest';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { unstakeAction, collectAction } from '../../../packages/core/src/flows/unstakeClaimActions.js';

const registry = defaultRegistry();
const PK = 'c'.repeat(64);
const PAST_AMOUNT_GUARD = /validator staking actions are accepted on Bitcoin only/;
const base = { chainRegistry: registry, chainId: 'litecoin-mainnet' };

const COMPOSERS = [
    ['collectAction', collectAction, {}],
    ['unstakeAction', unstakeAction, { SIGNING_PUBKEY: PK }],
];

describe.each(COMPOSERS)('%s amount intent', (name, compose, extra) => {
    it('refuses a missing AMOUNT without an explicit full request', async () => {
        await expect(compose({ ...base, params: { VERSION: '0', ...extra } }))
            .rejects.toThrow(`${name}: AMOUNT is required unless full is true`);
        await expect(compose({ ...base, full: 'yes', params: { VERSION: '0', ...extra } }))
            .rejects.toThrow(`${name}: AMOUNT is required unless full is true`);
    });

    it('accepts a missing AMOUNT only with full: true', async () => {
        await expect(compose({ ...base, full: true, params: { VERSION: '0', ...extra } }))
            .rejects.toThrow(PAST_AMOUNT_GUARD);
    });

    it('accepts a positive AMOUNT at 8 places and refuses empty, zero or finer ones', async () => {
        await expect(compose({ ...base, params: { VERSION: '0', ...extra, AMOUNT: '1.12345678' } }))
            .rejects.toThrow(PAST_AMOUNT_GUARD);
        for (const bad of ['', '0', '0.0', 'all', '1.123456789', null]) {
            await expect(compose({ ...base, full: true, params: { VERSION: '0', ...extra, AMOUNT: bad } }), String(bad))
                .rejects.toThrow(`${name}: AMOUNT must be a positive decimal`);
        }
    });
});
