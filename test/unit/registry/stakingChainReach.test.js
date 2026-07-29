// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : which chains advertise the contract lane vs the validator lane.
//
// The operator's decision (2026-07-23) is that token staking into a contract
// must work on BTC/LTC/DOGE while VALIDATOR (capability) staking stays
// Bitcoin-exclusive. The indexer already implements exactly that, and the
// shape of it is subtle enough to pin here:
//
//   - DEPLOY / EXECUTE / DEPOSIT / WITHDRAW carry no coin gate at all.
//   - STAKE v3, UNSTAKE v1, DELEGATE v1/v3 (contract-targeted) dispatch to
//     their own handlers BEFORE the `COIN !== 'BTC'` check.
//   - STAKE v1/v2, UNSTAKE v0, DELEGATE v0/v2 (capability) hit that check.
//   - COLLECT has ONE format, claims accrued validator rewards, and is gated
//     unconditionally - so it is the only action that is validator-lane by
//     definition.
//
// Because the split is per-VERSION for STAKE/UNSTAKE/DELEGATE but the registry
// is per-ACTION, those three are advertised on every chain and the
// validator-only SURFACES gate themselves at the form level. These tests hold
// both halves of that arrangement.

import { describe, it, expect } from 'vitest';
import {
    COMMON_ACTIONS,
    BTC_EXCLUSIVE_ACTIONS,
    BITCOIN_ACTIONS,
    LITECOIN_ACTIONS,
    DOGECOIN_ACTIONS,
} from '../../../packages/core/src/registry/actions.js';

// Actions whose contract-lane versions the indexer accepts on any chain, and
// which a wallet can now also PAY for there. DEPLOY/EXECUTE joined this list in
// , once the native-fee quote gap closed end to end (indexer ,
// wallet forms , fee placement /) and a wallet-composed
// DEPLOY paying the native fee indexed `valid` on both LTC and DOGE regtest.
const CONTRACT_LANE = ['DEPOSIT', 'WITHDRAW', 'STAKE', 'UNSTAKE', 'DELEGATE', 'DEPLOY', 'EXECUTE'];

describe(' staking + contract chain reach', () => {
    it('advertises the whole contract lane on Litecoin and Dogecoin', () => {
        for (const action of CONTRACT_LANE) {
            expect(LITECOIN_ACTIONS, `LTC should advertise ${action}`).toContain(action);
            expect(DOGECOIN_ACTIONS, `DOGE should advertise ${action}`).toContain(action);
        }
    });

    // . The hold-back this used to assert was a FEE-QUOTE gap, never a
    // chain refusal, and it is closed: the driver
    // tools/regtest/deployNativeFee.mjs composed a DEPLOY through
    // submitWithSigner (both branches) paying the fee in native coin, and the
    // indexer answered `valid` on litecoin-regtest (actions 1226-1228) and
    // dogecoin-regtest (action 953) on 2026-07-28. Re-run it before ever
    // re-asserting the hold-back: this is a venue fact, not a code opinion.
    it('advertises DEPLOY/EXECUTE on every chain now that the fee is payable there', () => {
        for (const action of ['DEPLOY', 'EXECUTE']) {
            expect(LITECOIN_ACTIONS).toContain(action);
            expect(DOGECOIN_ACTIONS).toContain(action);
            expect(BITCOIN_ACTIONS).toContain(action);
        }
    });

    it('keeps COLLECT Bitcoin-exclusive: it has no contract-targeted version', () => {
        expect(BTC_EXCLUSIVE_ACTIONS).toEqual(['COLLECT']);
        expect(BITCOIN_ACTIONS).toContain('COLLECT');
        expect(LITECOIN_ACTIONS).not.toContain('COLLECT');
        expect(DOGECOIN_ACTIONS).not.toContain('COLLECT');
    });

    it('leaves Bitcoin with everything it had', () => {
        for (const action of [...CONTRACT_LANE, 'COLLECT']) {
            expect(BITCOIN_ACTIONS).toContain(action);
        }
    });

    it('keeps the authorable union intact, so the manifest needs no re-vendor', () => {
        // The conformance guard binds COMMON + BTC_EXCLUSIVE (the union) to the
        // manifest's walletForm slice, and the manifest is not chain-scoped.
        // Moving an action between the two lists must therefore never change
        // the union - that is what makes this a wallet-local change.
        const union = [...new Set([...COMMON_ACTIONS, ...BTC_EXCLUSIVE_ACTIONS])];
        expect(union.length).toBe(BITCOIN_ACTIONS.length);
        for (const action of BITCOIN_ACTIONS) expect(union).toContain(action);
    });

    it('gives every chain the same set apart from the validator lane', () => {
        const ltcExtra = BITCOIN_ACTIONS.filter((a) => !LITECOIN_ACTIONS.includes(a));
        const dogeExtra = BITCOIN_ACTIONS.filter((a) => !DOGECOIN_ACTIONS.includes(a));
        expect(ltcExtra).toEqual(['COLLECT']);
        expect(dogeExtra).toEqual(['COLLECT']);
    });
});
