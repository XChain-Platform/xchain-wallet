// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sanitizeAbi guards ExecuteContractForm's render path: the contract `abi` is
// deployer-controlled display metadata the explorer relays verbatim, and a
// method whose `params` is not an array would throw on `.map` at render. With
// no ErrorBoundary in the wallet that white-screens the whole SPA, so every
// kept method MUST come back with an array `params`. These cases lock that in.

import { describe, it, expect } from 'vitest';
import {
    extractSingle,
    sanitizeAbi,
    contractMetaOf,
    contractAddressFor,
    contractDisplayLabel,
} from '../../../packages/core/src/shared/routes/contractResponseShape.js';

describe('sanitizeAbi', () => {
    it('drops a method whose params is a string (the render-crash input)', () => {
        // string params -> method dropped -> no methods left -> null (manual lane)
        const out = sanitizeAbi({ version: 1, methods: { transfer: { params: 'amount,to' } } });
        expect(out).toBeNull();
    });

    it('drops a method whose params is a non-array object, keeps valid siblings', () => {
        const out = sanitizeAbi({
            version: 1,
            methods: {
                good: { summary: 'ok', view: true, params: [{ name: 'x', type: 'amount' }] },
                bad:  { params: { a: 1 } },
            },
        });
        expect(Object.keys(out.methods)).toEqual(['good']);
        expect(Array.isArray(out.methods.good.params)).toBe(true);
        expect(out.methods.good).toMatchObject({ summary: 'ok', view: true });
    });

    it('treats missing params as an empty array (view function)', () => {
        const out = sanitizeAbi({ version: 1, methods: { info: { view: true } } });
        expect(out.methods.info.params).toEqual([]);
        expect(out.methods.info.view).toBe(true);
    });

    it('filters non-object param entries', () => {
        const out = sanitizeAbi({ version: 1, methods: { f: { params: [null, 'str', { name: 'y', type: 'tick' }] } } });
        expect(out.methods.f.params).toEqual([{ name: 'y', type: 'tick' }]);
    });

    it('every kept method always exposes an array params (invariant across shapes)', () => {
        const out = sanitizeAbi({
            version: 2,
            methods: {
                a: { params: [{ name: 'p', type: 'string' }] },
                b: { params: [] },
                c: { summary: 's' },
            },
        });
        for (const m of Object.values(out.methods)) expect(Array.isArray(m.params)).toBe(true);
    });

    it('returns null for structurally absent or malformed abis', () => {
        expect(sanitizeAbi(null)).toBeNull();
        expect(sanitizeAbi(undefined)).toBeNull();
        expect(sanitizeAbi({})).toBeNull();
        expect(sanitizeAbi({ version: 1 })).toBeNull();
        expect(sanitizeAbi({ version: 1, methods: 'nope' })).toBeNull();
        expect(sanitizeAbi({ version: 1, methods: {} })).toBeNull();
        expect(sanitizeAbi({ version: 1, methods: { onlyBad: { params: 42 } } })).toBeNull();
    });
});

describe('extractSingle', () => {
    it('unwraps the explorer single-record shapes to the row', () => {
        const row = { action_index: 5 };
        expect(extractSingle({ data: row })).toBe(row);
        expect(extractSingle({ data: [row] })).toBe(row);
        expect(extractSingle([row])).toBe(row);
        expect(extractSingle(row)).toBe(row);
        expect(extractSingle(null)).toBeNull();
    });
});

// Contract identity (CONTRACT_META_REQUIRED). The name, description and
// version are an export of the contract's own source, extracted by the indexer
// and relayed verbatim by the explorer, so they are author-controlled strings
// arriving on a signing-adjacent screen. Two things have to hold everywhere
// they are read: they are hardened before they reach a render, and the derived
// address is printed WITH the name, never instead of it (names are not unique
// and never will be).
describe('contractMetaOf', () => {
    it('reads the contract object\'s flat fields', () => {
        expect(contractMetaOf({
            meta_name: 'Escrow', meta_description: 'Two-party escrow', meta_version: '1.0.0',
        })).toEqual({ name: 'Escrow', description: 'Two-party escrow', version: '1.0.0' });
    });

    it('reads an action payload\'s prefixed fields', () => {
        expect(contractMetaOf({ contract_meta_name: 'Vesting', contract_meta_version: '2.1.0' }))
            .toEqual({ name: 'Vesting', description: null, version: '2.1.0' });
    });

    it('falls back to the parsed meta object, and ignores a non-object one', () => {
        expect(contractMetaOf({ meta: { name: 'Treasury', description: 'Holds funds' } }))
            .toEqual({ name: 'Treasury', description: 'Holds funds', version: null });
        expect(contractMetaOf({ meta: 'Treasury' }).name).toBeNull();
        expect(contractMetaOf({ meta: ['Treasury'] }).name).toBeNull();
    });

    it('answers all-null for a contract deployed before the flag day', () => {
        expect(contractMetaOf({ action_index: '12' }))
            .toEqual({ name: null, description: null, version: null });
        expect(contractMetaOf(null))
            .toEqual({ name: null, description: null, version: null });
    });

    it('neutralizes a bidi override rather than rendering it raw', () => {
        // A right-to-left override would let "Escrowtxt.exe" read as something
        // else entirely on the row it is spliced into.
        const out = contractMetaOf({ meta_name: 'Escrow‮gnp.exe' });
        expect(out.name).not.toContain('‮');
        expect(out.name).toContain('␦');
    });

    it('drops zero-width characters and flattens control characters', () => {
        expect(contractMetaOf({ meta_name: 'Es​crow' }).name).toBe('Escrow');
        expect(contractMetaOf({ meta_name: 'Escrow\r\nv2' }).name).toBe('Escrow v2');
    });

    it('caps each field at the consensus grammar\'s length', () => {
        expect(contractMetaOf({ meta_name: 'E'.repeat(200) }).name).toHaveLength(64);
        expect(contractMetaOf({ meta_version: 'v'.repeat(200) }).version).toHaveLength(32);
        expect(contractMetaOf({ meta_description: 'd'.repeat(900) }).description).toHaveLength(512);
    });

    it('treats a non-string or whitespace-only field as absent', () => {
        expect(contractMetaOf({ meta_name: 42 }).name).toBeNull();
        expect(contractMetaOf({ meta_name: '   ' }).name).toBeNull();
        expect(contractMetaOf({ meta_name: { toString: () => 'Escrow' } }).name).toBeNull();
    });
});

describe('contractAddressFor derives C:<COIN>:<index> off the BASE coin', () => {
    it('prints the base coin, not the network, for every network of a coin', () => {
        expect(contractAddressFor('bitcoin-regtest', 12)).toBe('C:BTC:12');
        expect(contractAddressFor('bitcoin-testnet', '12')).toBe('C:BTC:12');
        expect(contractAddressFor('bitcoin-mainnet', '12')).toBe('C:BTC:12');
        expect(contractAddressFor('dogecoin-regtest', '2154')).toBe('C:DOGE:2154');
        expect(contractAddressFor({ coin: 'litecoin' }, '3')).toBe('C:LTC:3');
    });

    it('answers null rather than a half-formed address', () => {
        expect(contractAddressFor('bitcoin-regtest', null)).toBeNull();
        expect(contractAddressFor('bitcoin-regtest', '')).toBeNull();
        expect(contractAddressFor('someones-custom-chain', '12')).toBeNull();
        expect(contractAddressFor(null, '12')).toBeNull();
    });
});

describe('contractDisplayLabel names a contract the same way on every surface', () => {
    const CHAIN = 'bitcoin-regtest';

    it('prints name, version and address', () => {
        expect(contractDisplayLabel(
            { meta_name: 'Escrow', meta_version: '1.0.0' }, { chainId: CHAIN, actionIndex: 12 },
        )).toBe('Escrow v1.0.0 (C:BTC:12)');
    });

    it('omits the version when the contract exports none', () => {
        expect(contractDisplayLabel(
            { meta_name: 'Escrow' }, { chainId: CHAIN, actionIndex: 12 },
        )).toBe('Escrow (C:BTC:12)');
    });

    it('reads "Unnamed contract" for a pre-activation contract', () => {
        expect(contractDisplayLabel({ action_index: '12' }, { chainId: CHAIN }))
            .toBe('Unnamed contract (C:BTC:12)');
    });

    it('takes the index off the row when the caller passes none', () => {
        expect(contractDisplayLabel(
            { contract_action_index: '99', contract_meta_name: 'Vesting' }, { chainId: CHAIN },
        )).toBe('Vesting (C:BTC:99)');
    });

    it('falls back to the number on a chain with no protocol coin', () => {
        expect(contractDisplayLabel({ meta_name: 'Escrow' }, { chainId: 'nope', actionIndex: 12 }))
            .toBe('Escrow #12');
    });

    it('never prints the name alone: the address is the identity', () => {
        const label = contractDisplayLabel(
            { meta_name: 'Escrow', meta_version: '1.0.0' }, { chainId: CHAIN, actionIndex: 12 },
        );
        expect(label).toContain('C:BTC:12');
    });
});
