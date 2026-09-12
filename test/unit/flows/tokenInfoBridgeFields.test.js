// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// P10: the token-info projection carries the four ISSUE v7 bridge fields.
//
// `normalizeTokenInfo` is a strict whitelist: a field it does not name is gone
// by the time any wallet surface sees the token. BRIDGE_CHAINS, MIN_DEPTH,
// LOCK_BRIDGE and the `bridged` bit were not in that whitelist, so the issuer
// panel could not pre-fill and BridgeMoveForm could not enforce the issuer's
// opt-in: every bridge surface degraded to "make no claim".
//
// What these pin is not the presence of four keys but the DISTINCTION the
// bridge rules turn on, driven through the two consumers that actually read
// them (`bridgeChainsList`, `bridgeDestinationError`):
//
//   absent  -> null -> unknown -> the wallet makes no claim either way
//   '-'     -> []   -> the issuer opted OUT -> the move is refused
//   'DOGE'  -> ['DOGE'] -> only that destination is offered
//
// Collapsing any two of those is how a wallet either blocks a legal move or
// lets a user pay a miner fee for a lock consensus will refuse.

import { describe, it, expect } from 'vitest';
import { normalizeTokenInfo } from '../../../packages/core/src/flows/tokenInfo.js';
import { bridgeChainsList, bridgeDestinationError } from '../../../packages/core/src/shared/routes/BridgeTick.js';

// The explorer's getToken grouping loop decides where each column lands:
// every `lock_*` column is folded into `locks` (so LOCK_BRIDGE arrives as
// `locks.bridge`), while bridge_chains / min_depth / bridged match no group
// prefix and stay in `info`. Rows here are shaped the way that loop emits them.
function explorerRow({ info = {}, locks = {} } = {}) {
    return {
        info: { tick: 'FUFU', owner: 'bc1qissuer', description: 'a token', ...info },
        locks: { description: false, max_supply: false, mint: false, mint_supply: false, sleep: false, ...locks },
        mints: {}, callback: {}, lists: {}, supply: { current: '100', max: '100' }, market: {},
    };
}

const norm = (row) => normalizeTokenInfo('bitcoin-regtest', 'FUFU', row);

describe('P10: bridge fields survive the token-info projection', () => {
    it('carries all four off an explorer-shaped row', () => {
        const info = norm(explorerRow({
            info: { bridge_chains: 'DOGE,LTC', min_depth: '6', bridged: '1' },
            locks: { bridge: true },
        }));
        expect(info.bridgeChains).toBe('DOGE,LTC');
        expect(info.minDepth).toBe('6');
        expect(info.lockBridge).toBe(true);
        expect(info.bridged).toBe(true);
    });

    it('answers null for every field a row does not carry, rather than a default', () => {
        const info = norm(explorerRow());
        expect(info.bridgeChains).toBeNull();
        expect(info.minDepth).toBeNull();
        // The freeze flag especially: a guessed `false` here offers an edit the
        // chain has already frozen forever.
        expect(info.lockBridge).toBeNull();
        expect(info.bridged).toBeNull();
    });

    it('keeps a present-but-unset flag distinct from an absent one', () => {
        const info = norm(explorerRow({ info: { bridged: 0 }, locks: { bridge: false } }));
        expect(info.lockBridge).toBe(false);
        expect(info.bridged).toBe(false);
    });

    it('reads the flat column name on a row that never went through the explorer', () => {
        const info = norm({ bridge_chains: 'DOGE', min_depth: 12, lock_bridge: 1, bridged: 1 });
        expect(info.bridgeChains).toBe('DOGE');
        expect(info.minDepth).toBe('12');
        expect(info.lockBridge).toBe(true);
        expect(info.bridged).toBe(true);
    });

    // --- what the projection lets the move form actually say -----------------

    it('an opt-in list refuses a destination the issuer left out, and passes one in it', () => {
        const info = norm(explorerRow({ info: { bridge_chains: 'LTC' } }));
        const chains = bridgeChainsList(info.bridgeChains);
        expect(chains).toEqual(['LTC']);

        const refused = bridgeDestinationError({
            tick: 'FUFU', sourceCoin: 'BTC', destCoin: 'DOGE', bridgeChains: chains,
        });
        expect(refused).toContain('Dogecoin');

        const allowed = bridgeDestinationError({
            tick: 'FUFU', sourceCoin: 'BTC', destCoin: 'LTC', bridgeChains: chains,
        });
        expect(allowed).toBeNull();
    });

    it("the '-' sentinel survives as an opt-OUT, not as an empty string", () => {
        const info = norm(explorerRow({ info: { bridge_chains: '-' } }));
        // Pre-splitting this into an array in the projection would erase the
        // distinction: String([]) is '' and reads back as "never set".
        expect(info.bridgeChains).toBe('-');
        expect(bridgeChainsList(info.bridgeChains)).toEqual([]);
        expect(bridgeDestinationError({
            tick: 'FUFU', sourceCoin: 'BTC', destCoin: 'DOGE', bridgeChains: bridgeChainsList(info.bridgeChains),
        })).toContain('has not opened it to the bridge');
    });

    it('an absent field leaves the move form making no claim either way', () => {
        const info = norm(explorerRow());
        expect(bridgeDestinationError({
            tick: 'FUFU', sourceCoin: 'BTC', destCoin: 'DOGE', bridgeChains: bridgeChainsList(info.bridgeChains),
        })).toBeNull();
    });

    it('an empty BRIDGE_CHAINS is unknown, not a refusal (empty means unchanged on the wire)', () => {
        const info = norm(explorerRow({ info: { bridge_chains: '' } }));
        expect(info.bridgeChains).toBeNull();
        expect(bridgeChainsList(info.bridgeChains)).toBeNull();
    });

    it('leaves the fields the projection already carried alone', () => {
        const info = norm(explorerRow({
            info: { bridge_chains: 'DOGE' },
            locks: { bridge: true, description: true },
        }));
        expect(info.creator).toBe('bc1qissuer');
        expect(info.totalSupply).toBe('100');
        expect(info.locked).toBe(true);
        expect(info.locks.bridge).toBe(true);
    });
});
