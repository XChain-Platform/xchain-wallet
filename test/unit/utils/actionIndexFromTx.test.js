// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-88: the two-transaction flows (AIRDROP, list fork, attach
// content, project roster) poll `getActionByTxid` after broadcasting step 1
// to learn the ACTION_INDEX step 2 must reference. The explorer answers
// /transaction/{txid}/tx_hash with the index nested inside an `actions` array
// and NO top-level `action_index`. Four forms each carried a private copy of
// this reader; ProjectRosterForm and AttachContentForm unwrapped the array,
// AirdropForm and ListForkForm did not - so their poll resolved to null
// forever while the catch above it read that as "not indexed yet".
//
// The first case below is the exact live payload, captured from the regtest
// explorer for the LIST transaction broadcast in wallet E2E session 19.

import { describe, it, expect } from 'vitest';
import { extractActionIndex } from '../../../packages/core/src/shared/utils/actionIndexFromTx.js';

// Verbatim response body, trimmed only of fields after tx_hash.
const LIVE_TX_RESPONSE = {
    actions: [{
        action_index: '1147',
        action: 'LIST',
        status: 'valid',
        details: {
            source: 'bcrt1qt4gtvdtdpz8mkan8ggjzv6d7jwxcfxygnxjwkc',
            type: '2',
            edit: null,
            action_format: 0,
            list_action_index: null,
        },
    }],
    block_index: '6345',
    source: 'bcrt1qt4gtvdtdpz8mkan8ggjzv6d7jwxcfxygnxjwkc',
    timestamp: '1785196626',
    tx_hash: '38ebb83dfaa412cac1938b544ba74b199d2304f797136b551335679ec0f73a8b',
};

describe('extractActionIndex', () => {
    it('reads the index out of the explorer envelope the poll actually receives', () => {
        // The whole defect in one assertion: pre-fix this returned null, so
        // AirdropForm sat on "Waiting for list to be indexed" indefinitely
        // with the LIST transaction already broadcast and paid for.
        expect(extractActionIndex(LIVE_TX_RESPONSE)).toBe('1147');
    });

    it('still reads an already-unwrapped action record', () => {
        expect(extractActionIndex({ action_index: '1147' })).toBe('1147');
        expect(extractActionIndex({ actionIndex: 1147 })).toBe('1147');
    });

    it('prefers a top-level index over the array when a host unwraps for us', () => {
        expect(extractActionIndex({ action_index: '900', actions: [{ action_index: '1147' }] }))
            .toBe('900');
    });

    it('returns null while the transaction is not indexed yet', () => {
        // The explorer answers 200 with an empty actions array between
        // broadcast and indexing; that is a normal retry state, not an error.
        expect(extractActionIndex({ actions: [], tx_data: null })).toBeNull();
        expect(extractActionIndex(null)).toBeNull();
        expect(extractActionIndex(undefined)).toBeNull();
        expect(extractActionIndex('1147')).toBeNull();
        expect(extractActionIndex({})).toBeNull();
    });

    it('treats an empty-string index as absent rather than truthy-by-accident', () => {
        expect(extractActionIndex({ actions: [{ action_index: '' }] })).toBeNull();
    });

    it('coerces a numeric index to a string, since callers thread it into params', () => {
        expect(extractActionIndex({ actions: [{ action_index: 1147 }] })).toBe('1147');
    });
});
