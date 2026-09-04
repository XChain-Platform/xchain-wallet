// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The deploy form's Name field labels the review screen, and until
// this store existed nothing persisted it, so every contract listed as
// "(unnamed)" no matter what the user typed. These tests pin the two halves of
// the fix that are easy to get wrong:
//
//   1. the deploy-time write, which usually has only a TXID (the single-leg
//      deploy lane returns before the indexer has assigned an action index),
//      and the later promotion of that label onto the index;
//   2. the read path staying pure, so rendering a list never writes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    MAX_CONTRACT_NAME_LENGTH,
    clearContractNames,
    contractNameFor,
    mergeContractNames,
    readContractNames,
    recordDeployedContractName,
    setContractName,
} from '../../../../packages/core/src/shared/utils/contractNameMemory.js';

const CHAIN = 'bitcoin-regtest';
const OTHER = 'litecoin-regtest';

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('setContractName / contractNameFor', () => {
    it('stores a label under chain + action index and reads it back', () => {
        setContractName({ chainId: CHAIN, actionIndex: '1418', name: 'MyMarket' });
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '1418' })).toBe('MyMarket');
        // Numbers and strings name the same contract.
        expect(contractNameFor({ chainId: CHAIN, actionIndex: 1418 })).toBe('MyMarket');
    });

    it('scopes labels per chain: the same index on another chain is a different contract', () => {
        setContractName({ chainId: CHAIN, actionIndex: '1418', name: 'MyMarket' });
        expect(contractNameFor({ chainId: OTHER, actionIndex: '1418' })).toBeNull();
    });

    it('trims and caps the label rather than storing what was pasted', () => {
        const stored = setContractName({
            chainId: CHAIN,
            actionIndex: '7',
            name: `  ${'x'.repeat(MAX_CONTRACT_NAME_LENGTH + 40)}  `,
        });
        expect(stored).toHaveLength(MAX_CONTRACT_NAME_LENGTH);
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '7' })).toHaveLength(MAX_CONTRACT_NAME_LENGTH);
    });

    it('a blank name removes the label instead of storing an empty string', () => {
        setContractName({ chainId: CHAIN, actionIndex: '7', name: 'Temp' });
        expect(setContractName({ chainId: CHAIN, actionIndex: '7', name: '   ' })).toBeNull();
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '7' })).toBeNull();
        // Nothing left behind: an empty store drops its key entirely.
        expect(localStorage.getItem(`xc:contractNames:${CHAIN}`)).toBeNull();
    });

    it('a rename replaces the previous label', () => {
        setContractName({ chainId: CHAIN, actionIndex: '9', name: 'First' });
        setContractName({ chainId: CHAIN, actionIndex: '9', name: 'Second' });
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '9' })).toBe('Second');
    });

    it('returns null for a missing chain or index rather than throwing', () => {
        expect(setContractName({ chainId: '', actionIndex: '1', name: 'x' })).toBeNull();
        expect(setContractName({ chainId: CHAIN, actionIndex: null, name: 'x' })).toBeNull();
        expect(contractNameFor({ chainId: CHAIN, actionIndex: undefined })).toBeNull();
    });
});

describe('recordDeployedContractName', () => {
    it('files the label under the txid when the action index is not known yet', () => {
        expect(recordDeployedContractName({
            chainId: CHAIN,
            actionIndex: null,
            txid: 'deadbeef',
            name: 'Escrow',
        })).toBe(true);
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '2000' })).toBeNull();
        expect(contractNameFor({ chainId: CHAIN, txid: 'deadbeef' })).toBe('Escrow');
    });

    it('files under both identities when the deploy result already carries the index', () => {
        recordDeployedContractName({ chainId: CHAIN, actionIndex: '2000', txid: 'cafe', name: 'Escrow' });
        const store = readContractNames(CHAIN);
        expect(store.byIndex['2000'].name).toBe('Escrow');
        expect(store.byTxid.cafe.name).toBe('Escrow');
    });

    it('stores nothing when the name is blank or no identity is known', () => {
        expect(recordDeployedContractName({ chainId: CHAIN, txid: 'abc', name: '  ' })).toBe(false);
        expect(recordDeployedContractName({ chainId: CHAIN, name: 'Escrow' })).toBe(false);
        expect(readContractNames(CHAIN)).toEqual({ byIndex: {}, byTxid: {} });
    });
});

describe('mergeContractNames', () => {
    it('attaches localName to rows by action index', () => {
        setContractName({ chainId: CHAIN, actionIndex: '1418', name: 'MyMarket' });
        const rows = mergeContractNames(CHAIN, [
            { action_index: 1418, status: 'valid' },
            { action_index: 1419, status: 'valid' },
        ]);
        expect(rows[0].localName).toBe('MyMarket');
        expect(rows[1].localName).toBeNull();
        // Rows are copied, never mutated.
        expect(rows[0].status).toBe('valid');
    });

    it('resolves interaction rows, which carry contract_action_index', () => {
        setContractName({ chainId: CHAIN, actionIndex: '55', name: 'Vault' });
        const [row] = mergeContractNames(CHAIN, [{ contract_action_index: '55', latestBlock: 9 }]);
        expect(row.localName).toBe('Vault');
    });

    it('promotes a txid-filed label onto the action index the first time both appear', () => {
        recordDeployedContractName({ chainId: CHAIN, txid: 'deadbeef', name: 'Escrow' });
        const [row] = mergeContractNames(CHAIN, [{ action_index: '2000', tx_hash: 'deadbeef' }]);
        expect(row.localName).toBe('Escrow');

        const store = readContractNames(CHAIN);
        expect(store.byIndex['2000'].name).toBe('Escrow');
        // The txid entry is spent: the label now lives under the stable identity.
        expect(store.byTxid.deadbeef).toBeUndefined();
        // And it resolves by index alone from here on, without the txid.
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '2000' })).toBe('Escrow');
    });

    it('leaves a txid-filed label alone while the row has no index to settle on', () => {
        recordDeployedContractName({ chainId: CHAIN, txid: 'deadbeef', name: 'Escrow' });
        const [row] = mergeContractNames(CHAIN, [{ tx_hash: 'deadbeef' }]);
        expect(row.localName).toBe('Escrow');
        expect(readContractNames(CHAIN).byTxid.deadbeef.name).toBe('Escrow');
    });

    it('does not write when nothing needs promoting', () => {
        setContractName({ chainId: CHAIN, actionIndex: '1418', name: 'MyMarket' });
        const spy = vi.spyOn(Storage.prototype, 'setItem');
        mergeContractNames(CHAIN, [{ action_index: '1418', tx_hash: 'abc' }]);
        expect(spy).not.toHaveBeenCalled();
    });

    it('returns the rows unchanged shape when the store is empty', () => {
        const rows = mergeContractNames(CHAIN, [{ action_index: '1' }]);
        expect(rows).toEqual([{ action_index: '1', localName: null }]);
    });

    it('survives a non-array argument', () => {
        expect(mergeContractNames(CHAIN, null)).toEqual([]);
        expect(mergeContractNames('', [{ action_index: '1' }])).toEqual([{ action_index: '1' }]);
    });
});

describe('storage robustness', () => {
    it('reads unparseable storage as an empty store rather than throwing', () => {
        localStorage.setItem(`xc:contractNames:${CHAIN}`, '{not json');
        expect(readContractNames(CHAIN)).toEqual({ byIndex: {}, byTxid: {} });
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '1' })).toBeNull();
    });

    it('drops malformed entries but keeps the good ones', () => {
        localStorage.setItem(`xc:contractNames:${CHAIN}`, JSON.stringify({
            byIndex: { 1: { name: '   ' }, 2: { name: 'Good' }, 3: 'AlsoGood' },
            byTxid: 'not an object',
        }));
        const store = readContractNames(CHAIN);
        expect(store.byIndex['1']).toBeUndefined();
        expect(store.byIndex['2'].name).toBe('Good');
        expect(store.byIndex['3'].name).toBe('AlsoGood');
        expect(store.byTxid).toEqual({});
    });

    it('swallows a write failure instead of breaking the deploy screen', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(() => setContractName({ chainId: CHAIN, actionIndex: '1', name: 'x' })).not.toThrow();
    });

    it('clearContractNames drops every label on that chain only', () => {
        setContractName({ chainId: CHAIN, actionIndex: '1', name: 'A' });
        setContractName({ chainId: OTHER, actionIndex: '1', name: 'B' });
        clearContractNames(CHAIN);
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '1' })).toBeNull();
        expect(contractNameFor({ chainId: OTHER, actionIndex: '1' })).toBe('B');
    });
});
