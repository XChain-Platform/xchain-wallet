// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Under list-edit resolution a reference to a list resolves to the newest
// valid edit in its chain, and the explorer reports that as
// `state.current_list` beside the as-created `list`. The shapes below are the
// ones seen on Dogecoin testnet: #2701 created with 2 members, later edited to
// 5, with `list` still showing the 2.

import { describe, it, expect } from 'vitest';
import { currentListItems, currentListMemberCount, findListOwner } from '../../../packages/core/src/flows/listMembership.js';

const A = 'nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const B = 'nBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const C = 'nCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

describe('currentListItems', () => {

    it('prefers the resolved membership over the as-created one', () => {
        const row = {
            list: [A, B],
            state: { edit_resolution_active: true, membership_action_index: 3069, current_list: [A, B, C] },
        };
        expect(currentListItems(row)).toEqual([A, B, C]);
    });

    it('falls back to the created members where the explorer says resolution is off', () => {
        const row = { list: [A, B], state: { edit_resolution_active: false, current_list: null } };
        expect(currentListItems(row)).toEqual([A, B]);
    });

    it('falls back to the created members on an explorer that predates state', () => {
        expect(currentListItems({ list: [A] })).toEqual([A]);
        expect(currentListItems({ items: [B] })).toEqual([B]);
        expect(currentListItems({ members: [C] })).toEqual([C]);
    });

    it('keeps an emptied list empty rather than reviving its created members', () => {
        const row = { list: [A, B], state: { edit_resolution_active: true, current_list: [] } };
        expect(currentListItems(row)).toEqual([]);
    });

    it('answers null when there is no member array at all', () => {
        expect(currentListItems(null)).toBe(null);
        expect(currentListItems({ action: 'LIST' })).toBe(null);
    });
});

// The list picker and the token access-list screen show this count beside a
// list index, and it has to be the count a gate bound to that index checks.
describe('currentListMemberCount', () => {

    it('counts the resolved membership, and answers null when there is none', () => {
        const row = { list: [A], state: { edit_resolution_active: true, current_list: [A, B, C] } };
        expect(currentListMemberCount(row)).toBe(3);
        expect(currentListMemberCount({ list: [A, B] })).toBe(2);
        expect(currentListMemberCount({ action: 'LIST' })).toBe(null);
    });
});

describe('findListOwner', () => {

    it('answers the creator directly for a root create', async () => {
        const readList = () => { throw new Error('no read needed'); };
        expect(await findListOwner({ detail: { source: A, list_action_index: null }, readList })).toBe(A);
    });

    // The case from the field: #3069 was an edit sent by a non-owner, and its
    // own SOURCE is not the owner of the list it edits.
    it('walks an edit up to its root create', async () => {
        const rows = { 2701: { source: A, list_action_index: null } };
        const readList = async (idx) => rows[idx];
        expect(await findListOwner({ detail: { source: B, list_action_index: '2701' }, readList })).toBe(A);
    });

    it('answers null when a parent cannot be read', async () => {
        const readList = async () => { throw new Error('offline'); };
        expect(await findListOwner({ detail: { source: B, list_action_index: '2701' }, readList })).toBe(null);
    });

    it('answers null on a parent cycle', async () => {
        const rows = { 1: { source: A, list_action_index: '2' }, 2: { source: B, list_action_index: '1' } };
        const readList = async (idx) => rows[idx];
        expect(await findListOwner({ detail: rows[1], readList })).toBe(null);
    });
});
