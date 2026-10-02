// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which chains advertise the contract lane vs the validator lane.
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

import { describe, it, expect, vi } from 'vitest';
import {
    COMMON_ACTIONS,
    BTC_EXCLUSIVE_ACTIONS,
    BITCOIN_ACTIONS,
    LITECOIN_ACTIONS,
    DOGECOIN_ACTIONS,
    validatorLaneChainIds,
    assertValidatorLaneChain,
    assertActionAllowedOnChain,
    isActionOfferedOnChain,
} from '../../../packages/core/src/registry/actions.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { stakeAction } from '../../../packages/core/src/flows/stakeAction.js';
import { unstakeAction, collectAction } from '../../../packages/core/src/flows/unstakeClaimActions.js';
import { delegateAction, revokeDelegationAction } from '../../../packages/core/src/flows/delegateRevokeActions.js';
import { advancedAction } from '../../../packages/core/src/flows/advancedAction.js';

// Actions whose contract-lane versions the indexer accepts on any chain, and
// which a wallet can now also PAY for there. DEPLOY/EXECUTE joined this list in
// Once the native-fee quote gap closed end to end (indexer,
// wallet forms, fee placement ) and a wallet-composed
// DEPLOY paying the native fee indexed `valid` on both LTC and DOGE regtest.
const CONTRACT_LANE = ['DEPOSIT', 'WITHDRAW', 'STAKE', 'UNSTAKE', 'DELEGATE', 'DEPLOY', 'EXECUTE'];

describe('staking + contract chain reach', () => {
    it('advertises the whole contract lane on Litecoin and Dogecoin', () => {
        for (const action of CONTRACT_LANE) {
            expect(LITECOIN_ACTIONS, `LTC should advertise ${action}`).toContain(action);
            expect(DOGECOIN_ACTIONS, `DOGE should advertise ${action}`).toContain(action);
        }
    });

    //The hold-back this used to assert was a FEE-QUOTE gap, never a
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

describe('validator lane chain gate', () => {
    const registry = defaultRegistry();
    const PK = 'a'.repeat(64);
    const VALIDATOR_COMPOSERS = [
        ['stakeAction', stakeAction, { VERSION: '1', AMOUNT: '1', SIGNING_PUBKEY: PK }],
        // A partial AMOUNT: an absent one now needs an explicit full request.
        ['unstakeAction', unstakeAction, { VERSION: '0', SIGNING_PUBKEY: PK, AMOUNT: '1' }],
        ['collectAction', collectAction, { VERSION: '0', AMOUNT: '1' }],
        ['delegateAction', delegateAction, { VERSION: '0', NEW_SIGNING_PUBKEY: PK }],
        ['revokeDelegationAction', revokeDelegationAction, { VERSION: '2', SIGNING_PUBKEY: PK }],
    ];

    it('offers only Bitcoin chains on the validator-lane forms', () => {
        const held = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-regtest', 'bitcoin-regtest'];
        expect(validatorLaneChainIds(held, registry)).toEqual(['bitcoin-mainnet', 'bitcoin-regtest']);
        expect(validatorLaneChainIds(['litecoin-mainnet', 'unknown-chain'], registry)).toEqual([]);
    });

    it('refuses every validator-lane composer on Litecoin and Dogecoin before signing', async () => {
        for (const [name, compose, params] of VALIDATOR_COMPOSERS) {
            for (const chainId of ['litecoin-mainnet', 'dogecoin-testnet']) {
                await expect(compose({ chainRegistry: registry, chainId, params }), `${name} on ${chainId}`)
                    .rejects.toThrow(`${name}: validator staking actions are accepted on Bitcoin only`);
            }
        }
    });

    it('lets every validator-lane composer past the gate on Bitcoin', async () => {
        for (const [name, compose, params] of VALIDATOR_COMPOSERS) {
            const run = compose({ chainRegistry: registry, chainId: 'bitcoin-regtest', params });
            await expect(run, name).rejects.not.toThrow(/accepted on Bitcoin only/);
        }
        expect(() => assertValidatorLaneChain(registry, 'bitcoin-mainnet', 'x')).not.toThrow();
    });
});

describe('generic composer chain gate', () => {
    const registry = defaultRegistry();
    const refusedOffBitcoin = [['COLLECT', 0], ['STAKE', 1], ['STAKE', 2], ['UNSTAKE', 0], ['DELEGATE', 0], ['DELEGATE', 2], ['XBRIDGE', 0]];
    const openEverywhere = [['STAKE', 3], ['UNSTAKE', 1], ['DELEGATE', 1], ['DELEGATE', 3], ['XBRIDGE', 3], ['XBRIDGE', 4], ['SEND', 0]];

    it('refuses the validator versions and XBRIDGE v0 off Bitcoin, and XBRIDGE v1 on it', () => {
        for (const chainId of ['litecoin-mainnet', 'dogecoin-regtest']) {
            for (const [action, version] of refusedOffBitcoin) {
                expect(() => assertActionAllowedOnChain(registry, chainId, action, version, 'x'), `${action} v${version} on ${chainId}`)
                    .toThrow(`x: ${action} version ${version} is accepted on Bitcoin only, not on ${chainId}`);
            }
            expect(() => assertActionAllowedOnChain(registry, chainId, 'XBRIDGE', 1, 'x')).not.toThrow();
        }
        for (const [action, version] of refusedOffBitcoin) {
            expect(() => assertActionAllowedOnChain(registry, 'bitcoin-regtest', action, version, 'x')).not.toThrow();
        }
        expect(() => assertActionAllowedOnChain(registry, 'bitcoin-mainnet', 'XBRIDGE', 1, 'x'))
            .toThrow('x: XBRIDGE version 1 is not accepted on Bitcoin');
    });

    it('leaves the contract-targeted versions and ungated actions open on every chain', () => {
        for (const chainId of ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-regtest']) {
            for (const [action, version] of openEverywhere) {
                expect(() => assertActionAllowedOnChain(registry, chainId, action, version, 'x'), `${action} v${version} on ${chainId}`)
                    .not.toThrow();
            }
        }
    });

    it('hides COLLECT from the composer pickers off Bitcoin only', () => {
        expect(isActionOfferedOnChain(registry, 'bitcoin-regtest', 'COLLECT')).toBe(true);
        expect(isActionOfferedOnChain(registry, 'litecoin-mainnet', 'COLLECT')).toBe(false);
        expect(isActionOfferedOnChain(registry, 'dogecoin-regtest', 'collect')).toBe(false);
        expect(isActionOfferedOnChain(registry, 'litecoin-mainnet', 'STAKE')).toBe(true);
    });

    /** advancedAction over an SDK whose compose resolves `version`. */
    function runAdvanced({ chainId, action, version }) {
        const composeActionString = vi.fn(() => ({ action, version }));
        const sdk = { actions: { composeActionString } };
        const run = advancedAction({
            chainRegistry: registry,
            sdkRegistry: { get: () => sdk, for: () => sdk },
            chainId,
            from: { address: 'addr', publicKey: '02'.padEnd(66, '1'), addressId: 'a1' },
            action,
            params: { AMOUNT: '1' },
        });
        return { run, composeActionString };
    }

    it('refuses an auto-versioned validator STAKE on Litecoin before anything is signed', async () => {
        const { run, composeActionString } = runAdvanced({ chainId: 'litecoin-regtest', action: 'STAKE', version: 1 });
        await expect(run).rejects.toThrow('advancedAction: STAKE version 1 is accepted on Bitcoin only, not on litecoin-regtest');
        expect(composeActionString).toHaveBeenCalledWith({ action: 'STAKE', params: { AMOUNT: '1' } }, { validate: false });
    });

    it('lets a contract STAKE on Litecoin and a validator STAKE on Bitcoin past the gate', async () => {
        for (const [chainId, version] of [['litecoin-regtest', 3], ['bitcoin-regtest', 1]]) {
            const { run } = runAdvanced({ chainId, action: 'STAKE', version });
            await expect(run).rejects.not.toThrow(/accepted on Bitcoin only/);
        }
    });

    it('never composes an ungated action twice', async () => {
        const { run, composeActionString } = runAdvanced({ chainId: 'litecoin-regtest', action: 'SEND', version: 0 });
        await expect(run).rejects.toBeTruthy();
        expect(composeActionString).not.toHaveBeenCalled();
    });
});
