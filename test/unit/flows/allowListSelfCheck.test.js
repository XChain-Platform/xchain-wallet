// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-161: a dispenser's ALLOW_LIST gates the dispenser's OWN pay-to address as
// well as the buyer's, so a seller who lists only their customers builds a
// dispenser that refuses every sale.
//
// PROVEN ON CHAIN before this guard was written (Litecoin regtest, 2026-07-31,
// `tests/dispensers/owner-off-allow-list.regtest.spec.js`): DISPENSE **1997**
// `invalid: GET_ADDRESS (dispenser allow list)` with the escrow untouched and
// the buyer out the coin, against DISPENSE **1998** `valid` crediting 25 XCHAIN
// from a dispenser whose list differs by ONE member - its own address.
//
// The cases below are all about the BOUNDARY between "known bad" and "unknown",
// because this drives a warning: a warning on a failed read is worse than
// silence, since it teaches the user to ignore the next one.

import { describe, it, expect } from 'vitest';
import {
    listMembers,
    dispenserCreateAllowListVerdict,
    ownerOffAllowList,
    ownerOffAllowListMessage,
    buyerListVerdict,
    buyerListMessage,
    dispenserRefusesEveryoneMessage,
} from '../../../packages/core/src/flows/allowListSelfCheck.js';

const OWNER = 'rltc1qxg7wh2s28fpzq8qj2cj60573wdh9unavzfvwqy';
const BUYER = 'rltc1q9jynzmnrh6qhelq99lgkylu0zzg5p5enwdmzl6';

describe('listMembers', () => {

    it('reads the explorer shape a LIST action actually returns', () => {
        expect(listMembers({ list: [BUYER, OWNER] })).toEqual([BUYER, OWNER]);
    });

    it('reads row objects as well as bare strings', () => {
        expect(listMembers({ list: [{ address: BUYER }, { item: OWNER }] }))
            .toEqual([BUYER, OWNER]);
    });

    it('tolerates the other two names the same field has had', () => {
        expect(listMembers({ items: [BUYER] })).toEqual([BUYER]);
        expect(listMembers({ members: [BUYER] })).toEqual([BUYER]);
    });

    // The distinction the whole guard rests on: a list with no member array is
    // UNKNOWN, not empty. Returning [] here would turn every failed read into a
    // confident "the owner is missing".
    it('answers null when there is no member array at all', () => {
        expect(listMembers({ action: 'LIST' })).toBe(null);
        expect(listMembers(null)).toBe(null);
        expect(listMembers('nope')).toBe(null);
    });

    it('answers an empty array for a list that really is empty', () => {
        expect(listMembers({ list: [] })).toEqual([]);
    });

    // The dispenser gate checks the list's newest valid edit. Reading the
    // as-created `list` warned about (and hid) the wrong addresses for any list
    // that had been edited.
    it('reads the membership the list resolves to, not the one it was created with', () => {
        const row = {
            list: [BUYER],
            state: { edit_resolution_active: true, membership_action_index: 3069, current_list: [BUYER, OWNER] },
        };
        expect(listMembers(row)).toEqual([BUYER, OWNER]);
        expect(ownerOffAllowList({ members: listMembers(row), getAddress: OWNER })).toBe(false);
    });
});

describe('dispenserCreateAllowListVerdict', () => {

    const SOURCE = 'rltc1qsourcesourcesourcesourcesourcesourcesou';

    it('bars a new dispenser address before it is even derived', () => {
        expect(dispenserCreateAllowListVerdict({
            members: [SOURCE, BUYER], getAddress: null, sourceAddress: SOURCE, newAddressPending: true,
        })).toEqual({ barred: true, createFirst: true });
    });

    // The false negative from the field: SOURCE is on the list, the dispenser
    // opens elsewhere, and SOURCE being listed says nothing about that address.
    it('judges the address the dispenser opens on, not SOURCE', () => {
        expect(dispenserCreateAllowListVerdict({
            members: [SOURCE, BUYER], getAddress: OWNER, sourceAddress: SOURCE,
        })).toEqual({ barred: true, createFirst: true });
    });

    it('keeps the plain remedy for a dispenser opening on SOURCE itself', () => {
        expect(dispenserCreateAllowListVerdict({
            members: [BUYER], getAddress: SOURCE, sourceAddress: SOURCE,
        })).toEqual({ barred: true, createFirst: false });
    });

    it('does not bar an address that is on the list', () => {
        expect(dispenserCreateAllowListVerdict({
            members: [BUYER, OWNER], getAddress: OWNER, sourceAddress: SOURCE,
        }).barred).toBe(false);
    });

    it('does not bar on an unknown or empty list, even for a pending new address', () => {
        for (const members of [null, undefined, []]) {
            expect(dispenserCreateAllowListVerdict({
                members, getAddress: null, sourceAddress: SOURCE, newAddressPending: true,
            }).barred).toBe(false);
        }
    });
});

describe('ownerOffAllowList', () => {

    it('is true for the case measured on chain: customers listed, owner not', () => {
        expect(ownerOffAllowList({ members: [BUYER], getAddress: OWNER })).toBe(true);
    });

    it('is false once the owner is on the list', () => {
        expect(ownerOffAllowList({ members: [BUYER, OWNER], getAddress: OWNER })).toBe(false);
    });

    // `dispense.js` consults a list only when it has entries
    // (`if(dispenserAllowList.length)`), so an empty list gates nobody.
    it('is false for an empty list, which refuses nothing', () => {
        expect(ownerOffAllowList({ members: [], getAddress: OWNER })).toBe(false);
    });

    it('is false whenever the answer is not known', () => {
        expect(ownerOffAllowList({ members: null, getAddress: OWNER })).toBe(false);
        expect(ownerOffAllowList({ members: undefined, getAddress: OWNER })).toBe(false);
        expect(ownerOffAllowList({ members: [BUYER], getAddress: '' })).toBe(false);
        expect(ownerOffAllowList({ members: [BUYER], getAddress: null })).toBe(false);
    });

    // The gate address is compared exactly, the way the indexer's
    // `Array.includes` does. Trimming the input is the one liberty taken, since
    // a form field can carry whitespace the chain never sees.
    it('compares exactly, but ignores whitespace around the input', () => {
        expect(ownerOffAllowList({ members: [OWNER], getAddress: `  ${OWNER}  ` })).toBe(false);
        expect(ownerOffAllowList({ members: [OWNER.toUpperCase()], getAddress: OWNER })).toBe(true);
    });
});

describe('ownerOffAllowListMessage', () => {

    it('names the consequence and who pays it, not just the remedy', () => {
        const copy = ownerOffAllowListMessage(OWNER);
        expect(copy).toMatch(/every purchase would be refused/i);
        expect(copy).toMatch(/after paying/i);
        expect(copy).toMatch(/add this address to the list|clear the list/i);
    });

    it('abbreviates the address rather than wrapping the sentence around it', () => {
        const copy = ownerOffAllowListMessage(OWNER);
        expect(copy).toContain(OWNER.slice(0, 8));
        expect(copy).toContain(OWNER.slice(-6));
        expect(copy).not.toContain(OWNER);
    });

    it('shows a short address whole', () => {
        expect(ownerOffAllowListMessage('short1234')).toContain('short1234');
    });

    // Listing a not-yet-used dispenser address first counts as activity and
    // the create is refused, so the advice for any address other than SOURCE is
    // to create first and list the address afterwards.
    it('tells a dispenser opening elsewhere to create first and list it afterwards', () => {
        const copy = ownerOffAllowListMessage(OWNER, { createFirst: true });
        expect(copy).toMatch(/every purchase would be refused/i);
        expect(copy).toMatch(/create the dispenser first, then add its address to the list/i);
        expect(copy).toMatch(/refuses to open a dispenser there/i);
        expect(copy).not.toMatch(/Add this address to the list, or clear the list/);
    });

    it('speaks of a new address when none is derived yet', () => {
        expect(ownerOffAllowListMessage(null, { createFirst: true })).toMatch(/^The new dispenser address will not be on the allow-list/);
    });
});

// D-162: the same gate from the BUYER's side. The panel already said "this
// dispenser is restricted" and named the list, then told the buyer to "check
// you are on the right side of the list before sending" - a lookup the wallet
// can do off the read the list picker already makes.
describe('buyerListVerdict', () => {

    const A = 'rltc1qaaa';
    const B = 'rltc1qbbb';

    it('says nothing when there are no lists to judge against', () => {
        expect(buyerListVerdict({ addresses: [A], allowMembers: null, blockMembers: null }).verdict)
            .toBe('unknown');
    });

    it('says nothing when the wallet holds no addresses on the chain', () => {
        expect(buyerListVerdict({ addresses: [], allowMembers: [A] }).verdict).toBe('unknown');
    });

    it('refuses when no address of this wallet is on the allow-list', () => {
        const v = buyerListVerdict({ addresses: [A, B], allowMembers: [OWNER] });
        expect(v.verdict).toBe('refused');
        expect(v.refused).toEqual([A, B]);
    });

    it('is ok when every address is allowed', () => {
        expect(buyerListVerdict({ addresses: [A, B], allowMembers: [A, B, OWNER] }).verdict)
            .toBe('ok');
    });

    // The wallet picks the payer, not the user, so "some of your addresses
    // work" is a different situation from "you are fine" and gets its own word.
    it('reports partial when only some addresses are allowed', () => {
        const v = buyerListVerdict({ addresses: [A, B], allowMembers: [A] });
        expect(v.verdict).toBe('partial');
        expect(v.accepted).toEqual([A]);
        expect(v.refused).toEqual([B]);
    });

    it('applies the BLOCK list, which gates the opposite way', () => {
        expect(buyerListVerdict({ addresses: [A], blockMembers: [A] }).verdict).toBe('refused');
        expect(buyerListVerdict({ addresses: [A], blockMembers: [B] }).verdict).toBe('ok');
    });

    it('refuses an address caught by either list', () => {
        const v = buyerListVerdict({ addresses: [A, B], allowMembers: [A, B], blockMembers: [B] });
        expect(v.verdict).toBe('partial');
        expect(v.refused).toEqual([B]);
    });

    // Same rule as the seller side: an empty list gates nobody, because
    // `dispense.js` only consults a list when it has entries.
    it('treats an empty list as no list', () => {
        expect(buyerListVerdict({ addresses: [A], allowMembers: [], blockMembers: [] }).verdict)
            .toBe('unknown');
    });
});

describe('the buyer-side sentences', () => {

    it('speaks only for the verdicts a buyer can act on', () => {
        expect(buyerListMessage({ verdict: 'unknown', accepted: [], refused: [] })).toBe(null);
        expect(buyerListMessage({ verdict: 'ok', accepted: ['a'], refused: [] })).toBe(null);
        expect(buyerListMessage(null)).toBe(null);
    });

    it('says what happens to the money, not just that access is denied', () => {
        expect(buyerListMessage({ verdict: 'refused', accepted: [], refused: ['a'] }))
            .toMatch(/not returned/i);
        expect(buyerListMessage({ verdict: 'partial', accepted: ['a'], refused: ['b'] }))
            .toMatch(/not returned/i);
    });

    it('counts the addresses in the partial case, since that is the remedy', () => {
        expect(buyerListMessage({ verdict: 'partial', accepted: ['a'], refused: ['b', 'c'] }))
            .toMatch(/Only 1 of this wallet's 3 addresses/);
    });

    // The one verdict that is not about the buyer at all.
    it('names the owner-off-list case as unfixable by the buyer', () => {
        const copy = dispenserRefusesEveryoneMessage();
        expect(copy).toMatch(/cannot sell to anyone/i);
        expect(copy).toMatch(/its own pay-to address/i);
        expect(copy).toMatch(/only its owner can fix it/i);
    });
});
