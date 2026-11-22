// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The read-back has to answer both directions. A LIST item can go on the wire
// as a `^id` reference that the indexer resolves when it indexes the LIST, so
// the stored list can hold an address the user never submitted; the airdrop
// would pay it, so the check names it.

import { describe, expect, it } from 'vitest';
import { reconcileStoredList } from '../../../packages/core/src/airdrop/parseRecipients.js';

const BTC_MAINNET = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BTC_LEGACY = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const BTC_FOREIGN = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';

describe('reconcileStoredList foreign stored members', () => {
    it('names a swapped member when the counts still match', () => {
        const out = reconcileStoredList([BTC_MAINNET, BTC_LEGACY], [BTC_MAINNET, BTC_FOREIGN]);

        expect(out.missing).toEqual([BTC_LEGACY]);
        expect(out.unexpected).toEqual([BTC_FOREIGN]);
        expect(out.ok).toBe(false);
    });

    it('names a pure extra and is not ok even with nothing missing', () => {
        const out = reconcileStoredList([BTC_MAINNET], [BTC_MAINNET, BTC_FOREIGN]);

        expect(out.missing).toEqual([]);
        expect(out.unexpected).toEqual([BTC_FOREIGN]);
        expect(out.ok).toBe(false);
    });

    it('does not report a case-folded bech32 form of a submitted address', () => {
        const out = reconcileStoredList([BTC_MAINNET.toUpperCase()], [BTC_MAINNET]);

        expect(out.unexpected).toEqual([]);
        expect(out.ok).toBe(true);
    });

    it('does not report a stored spelling that differs only in case from a submitted base58 address', () => {
        const changedCase = `${BTC_LEGACY.slice(0, 2)}w${BTC_LEGACY.slice(3)}`;
        expect(changedCase).not.toBe(BTC_LEGACY);
        const out = reconcileStoredList([BTC_LEGACY], [changedCase]);

        expect(out.unexpected).toEqual([]);
    });

    it('still reports a base58 member that folds to no submitted address', () => {
        const out = reconcileStoredList([BTC_LEGACY], [BTC_LEGACY.toLowerCase(), BTC_FOREIGN.toLowerCase()]);

        expect(out.unexpected).toEqual([BTC_FOREIGN.toLowerCase()]);
        expect(out.ok).toBe(false);
    });

    it.each([
        ['a P2SH address', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
        ['a Dogecoin address', 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L'],
    ])('does not report a case-variant read-back of %s', (_label, submitted) => {
        const out = reconcileStoredList([submitted], [submitted.toLowerCase()]);

        expect(out.unexpected).toEqual([]);
    });

    it('does not fold a stored spelling onto a submitted address no network accepts', () => {
        const malformed = `1${'z'.repeat(30)}`;
        const out = reconcileStoredList([malformed], [malformed.toUpperCase()]);

        expect(out.unexpected).toEqual([malformed.toUpperCase()]);
    });

    it('lists a repeated foreign member once, in stored order', () => {
        const out = reconcileStoredList(
            [BTC_MAINNET],
            [BTC_FOREIGN, { address: BTC_LEGACY }, ` ${BTC_FOREIGN} `, { item: BTC_MAINNET }],
        );

        expect(out.unexpected).toEqual([BTC_FOREIGN, BTC_LEGACY]);
    });

    it('never reports blank or empty stored rows', () => {
        const out = reconcileStoredList([BTC_LEGACY], [null, '', '  ', {}, { item: null }, BTC_LEGACY]);

        expect(out.unexpected).toEqual([]);
        expect(out.ok).toBe(true);
    });
});
