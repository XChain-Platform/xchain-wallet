// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, it, expect, vi } from 'vitest';
import { sharedListDirectory } from '../../../packages/core/src/flows/sharedLists.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { validateChainDescriptor } from '../../../packages/core/src/registry/validate.js';

const descriptors = [
    { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest', platformListOwners: ['btc-platform'] },
    { id: 'litecoin-regtest', coin: 'litecoin', networkKind: 'regtest', platformListOwners: ['ltc-platform'] },
    { id: 'dogecoin-regtest', coin: 'dogecoin', networkKind: 'regtest', platformListOwners: ['doge-platform'] },
];

function home(homeChain, homeIndex, owner, type = 2) {
    return {
        kind: 'home',
        home_chain: homeChain,
        home_list_index: homeIndex,
        local_list_index: homeIndex,
        type,
        owner,
        member_count: 3,
        share_block: 50,
        share_action_index: homeIndex + 1,
        seq: 1,
    };
}

function mirror(homeChain, homeIndex, localIndex) {
    return {
        kind: 'mirror',
        home_chain: homeChain,
        home_list_index: homeIndex,
        local_list_index: localIndex,
        type: 2,
        owner: null,
        member_count: 3,
        share_block: 50,
        share_action_index: homeIndex + 1,
        seq: 1,
    };
}

function harness(overrides = {}) {
    const rows = {
        'bitcoin-regtest': [
            home('BTC', 101, 'btc-platform'),
            mirror('LTC', 202, 1202),
            mirror('DOGE', 303, 1303),
        ],
        'litecoin-regtest': [home('LTC', 202, 'ltc-owner')],
        'dogecoin-regtest': [home('DOGE', 303, 'doge-platform')],
        ...overrides,
    };
    const gets = new Map();
    const sdkRegistry = {
        get: vi.fn((chainId) => {
            const get = vi.fn(async () => {
                const value = rows[chainId];
                if (value instanceof Error) throw value;
                return { data: value };
            });
            gets.set(chainId, get);
            return { explorer: { get } };
        }),
    };
    const chainRegistry = {
        get: (chainId) => descriptors.find((descriptor) => descriptor.id === chainId),
        byNetworkKind: (networkKind) => descriptors.filter((descriptor) => descriptor.networkKind === networkKind),
    };
    return { sdkRegistry, chainRegistry, gets };
}

describe('sharedListDirectory', () => {
    it('merges home rows and resolves viewing-chain bind targets from mirrors', async () => {
        const state = harness();
        const result = await sharedListDirectory({
            sdkRegistry: state.sdkRegistry,
            chainRegistry: state.chainRegistry,
            chainId: 'bitcoin-regtest',
        });

        expect(result.unavailable).toEqual([]);
        expect(result.lists).toHaveLength(3);
        expect(result.lists.map((row) => ({
            home: row.home_chain,
            bindTarget: row.bindTarget,
            maintainedByPlatform: row.maintainedByPlatform,
        }))).toEqual([
            { home: 'BTC', bindTarget: 101, maintainedByPlatform: true },
            { home: 'LTC', bindTarget: 1202, maintainedByPlatform: false },
            { home: 'DOGE', bindTarget: 1303, maintainedByPlatform: true },
        ]);
        for (const get of state.gets.values()) {
            expect(get).toHaveBeenCalledWith('/shared_lists', { noRetry: true });
        }
    });

    it('keeps other chains readable when one explorer fails', async () => {
        const state = harness({ 'litecoin-regtest': new Error('404') });
        const result = await sharedListDirectory({
            sdkRegistry: state.sdkRegistry,
            chainRegistry: state.chainRegistry,
            chainId: 'bitcoin-regtest',
        });

        expect(result.unavailable).toEqual(['litecoin-regtest']);
        expect(result.lists.map((row) => row.home_chain)).toEqual(['BTC', 'DOGE']);
    });
});

describe('platformListOwners descriptor validation', () => {
    const base = BUNDLED_DESCRIPTORS.find((descriptor) => descriptor.id === 'bitcoin-mainnet');

    it('accepts bundled descriptors and a descriptor without the optional field', () => {
        for (const descriptor of BUNDLED_DESCRIPTORS) {
            expect(validateChainDescriptor(descriptor).ok, descriptor.id).toBe(true);
            expect(descriptor.platformListOwners).toEqual([]);
        }
        const withoutOwners = { ...base };
        delete withoutOwners.platformListOwners;
        expect(validateChainDescriptor(withoutOwners).ok).toBe(true);
    });

    it('refuses a non-array or an empty-string entry', () => {
        for (const platformListOwners of ['btc-platform', ['btc-platform', '']]) {
            const result = validateChainDescriptor({ ...base, platformListOwners });
            expect(result.ok).toBe(false);
            expect(result.errors.join(' ')).toMatch(/platformListOwners/);
        }
    });
});
