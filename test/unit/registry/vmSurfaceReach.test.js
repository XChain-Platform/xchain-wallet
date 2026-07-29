// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// : the contract surfaces reach every chain the registry says can carry
// contracts, and no surface reaches further than its own lane.
//
// The flip of BTC_EXCLUSIVE_ACTIONS is only half a change: it does nothing a
// user can see unless the SURFACES ask the registry rather than pinning a coin.
// Three of them did pin one - ContractsList's VM_COIN, the shells' shared
// BTC-address nav gate, and (before ) DeployContractForm - and each would
// have kept contracts invisible on LTC/DOGE while the registry advertised them.
// So this pins the derivation itself, in the same shape the surfaces use.

import { describe, it, expect } from 'vitest';
import * as registryLib from '../../../packages/core/src/registry/index.js';

const chainRegistry = registryLib.defaultRegistry();

const vmChains = chainRegistry.supportedChains()
    .filter((d) => Array.isArray(d.supportedActions) && d.supportedActions.includes('DEPLOY'))
    .map((d) => d.id);

describe(' contract-surface chain reach', () => {

    it('advertises DEPLOY on the Litecoin and Dogecoin chains, not just Bitcoin', () => {
        for (const id of [
            'bitcoin-mainnet', 'bitcoin-testnet', 'bitcoin-regtest',
            'litecoin-mainnet', 'litecoin-testnet', 'litecoin-regtest',
            'dogecoin-mainnet', 'dogecoin-testnet', 'dogecoin-regtest',
        ]) {
            expect(vmChains, `${id} should carry contracts`).toContain(id);
        }
    });

    // The venue proof is regtest-only, but the gate is not chain-network
    // scoped: mainnet LTC/DOGE settle protocol fees the same way. Pinned so a
    // future network-scoped narrowing is a deliberate edit, not a silent one.
    it('does not split the reach by network kind', () => {
        const coins = new Set(chainRegistry.supportedChains()
            .filter((d) => vmChains.includes(d.id)).map((d) => d.coin));
        for (const coin of coins) {
            const all = chainRegistry.byCoin(coin).map((d) => d.id);
            for (const id of all) expect(vmChains).toContain(id);
        }
    });

    // The nav used ONE hook for Contracts and Staking. Contracts moved and
    // validator staking did not, so the two sets must now differ - if they are
    // equal again, either the flip was reverted or the staking gate was widened
    // by accident.
    it('reaches further than the Bitcoin-only lane the staking nav still uses', () => {
        const btcChains = chainRegistry.byCoin('bitcoin').map((d) => d.id);
        expect(vmChains.length).toBeGreaterThan(btcChains.length);
        for (const id of btcChains) expect(vmChains).toContain(id);
    });
});
