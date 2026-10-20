// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The airdrop recipient parser must validate NETWORK, not only form.
//
// Wallet E2E session 19 pasted five lines into Airdrop on a REGTEST wallet:
// two regtest addresses, one duplicate, one MAINNET bech32, one garbage
// string. The form reported "3 valid addresses - 1 duplicate removed - 1
// invalid skipped" and listed only the garbage string as invalid, so the
// mainnet address was counted, reviewed, dry-run approved and paid for. The
// indexer then wrote two rows to `list_items`, put the mainnet address in
// `list_items_invalid` (status 60, `invalid: ADDRESS (format)`) and marked the
// LIST action itself valid - a list permanently one item shorter than the one
// the user bought, with no wallet screen ever saying so.
//
// The second half of the fix is `reconcileStoredList`: the client-side check
// can still be wrong (older build, a chain rule the wallet does not model), so
// the flow reads the published list back and compares before pricing step 2.

import { describe, it, expect } from 'vitest';
import {
    applyTokenAccessLists,
    bech32IdentityKey,
    classifyRecipientEntries,
    classifyRecipients,
    isRecipientForChain,
    isPlausibleAddress,
    parseCsv,
    reconcileStoredList,
} from '../../../packages/core/src/airdrop/parseRecipients.js';

// The exact five lines from the session-19 reproduction.
const REGTEST_BECH32 = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const REGTEST_LEGACY = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
const MAINNET_BECH32 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const MAINNET_LEGACY = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const LITECOIN_BECH32 = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';
const LITECOIN_REGTEST_BECH32 = 'rltc1qmr46t4ca5wh35k6mczdzrkepqw2d8ne92hnush';
const GARBAGE = 'notanaddress';

const BTC_REGTEST = { coin: 'bitcoin', network: 'regtest' };
const BTC_MAINNET = { coin: 'bitcoin', network: 'mainnet' };

describe('parseCsv recipient imports', () => {
    it('recognizes a spreadsheet header after a BOM and blank lines', () => {
        expect(parseCsv(`\uFEFF\n\naddress,label\n${MAINNET_BECH32},primary\n`))
            .toEqual([MAINNET_BECH32]);
    });

    it('does not turn a quoted multiline label into another address', () => {
        expect(parseCsv(
            `"address","label"\r\n${MAINNET_BECH32},"primary\nwallet"\r\n${MAINNET_LEGACY},second\r\n`,
        )).toEqual([MAINNET_BECH32, MAINNET_LEGACY]);
    });

});

describe('classifyRecipients - network-aware validation', () => {
    it('does not count a mainnet address as valid on a regtest wallet', () => {
        const out = classifyRecipients([
            REGTEST_BECH32,
            REGTEST_BECH32, // duplicate
            REGTEST_LEGACY,
            MAINNET_BECH32,
            GARBAGE,
        ], BTC_REGTEST);

        expect(out.valid).toEqual([REGTEST_BECH32, REGTEST_LEGACY]);
        expect(out.duplicates).toBe(1);
        expect(out.invalid).toContain(MAINNET_BECH32);
        expect(out.invalid).toContain(GARBAGE);
        // The count the summary line prints must match what the chain keeps.
        expect(out.valid.length).toBe(2);
    });

    it('separates a wrong-network address from actual garbage', () => {
        const out = classifyRecipients([MAINNET_BECH32, GARBAGE], BTC_REGTEST);
        expect(out.wrongNetwork).toEqual([MAINNET_BECH32]);
        // Still inside `invalid`, so every "N invalid skipped" count keeps
        // totalling everything that was dropped.
        expect(out.invalid).toEqual([MAINNET_BECH32, GARBAGE]);
    });

    it('rejects another coin on the same network kind', () => {
        const out = classifyRecipients([LITECOIN_BECH32], BTC_MAINNET);
        expect(out.valid).toEqual([]);
        expect(out.wrongNetwork).toEqual([LITECOIN_BECH32]);
    });

    it('rejects a regtest address on a mainnet wallet (the mirror case)', () => {
        const out = classifyRecipients([MAINNET_LEGACY, REGTEST_BECH32], BTC_MAINNET);
        expect(out.valid).toEqual([MAINNET_LEGACY]);
        expect(out.wrongNetwork).toEqual([REGTEST_BECH32]);
    });

    it('catches a checksum typo that keeps a plausible leading character', () => {
        const typo = `${MAINNET_LEGACY.slice(0, -1)}t`;
        expect(isPlausibleAddress(typo)).toBe(true); // form alone says yes
        const out = classifyRecipients([typo], BTC_MAINNET);
        expect(out.valid).toEqual([]);
        expect(out.invalid).toEqual([typo]);
        expect(out.wrongNetwork).toEqual([]);
    });

    it('keeps the loose form-only check when no chain is known', () => {
        // A form that has not resolved its chain yet still has to render
        // something; it must not reject every address.
        const out = classifyRecipients([MAINNET_BECH32, GARBAGE], null);
        expect(out.valid).toEqual([MAINNET_BECH32]);
        expect(out.invalid).toEqual([GARBAGE]);
        expect(out.wrongNetwork).toEqual([]);
    });

    it('accepts a registry descriptor shape (networkKind) as well as {network}', () => {
        const viaDescriptor = classifyRecipients(
            [REGTEST_BECH32, MAINNET_BECH32],
            { coin: 'bitcoin', networkKind: 'regtest' },
        );
        expect(viaDescriptor.valid).toEqual([REGTEST_BECH32]);
    });

    it('falls back to the loose check when the chain is half-populated', () => {
        const out = classifyRecipients([MAINNET_BECH32], { coin: 'bitcoin', network: null });
        expect(out.valid).toEqual([MAINNET_BECH32]);
    });

    it('isRecipientForChain answers per address', () => {
        expect(isRecipientForChain(REGTEST_BECH32, BTC_REGTEST)).toBe(true);
        expect(isRecipientForChain(MAINNET_BECH32, BTC_REGTEST)).toBe(false);
        expect(isRecipientForChain(`  ${REGTEST_BECH32}  `, BTC_REGTEST)).toBe(true);
        expect(isRecipientForChain(null, BTC_REGTEST)).toBe(false);
    });

    it('trims candidates and counts case variants of bech32 as duplicates', () => {
        const out = classifyRecipients([
            `  ${MAINNET_BECH32}  `,
            MAINNET_BECH32.toUpperCase(),
        ], BTC_MAINNET);
        expect(out.valid).toEqual([MAINNET_BECH32]);
        expect(out.duplicates).toBe(1);
    });

    it('counts Litecoin regtest case variants as duplicates', () => {
        const out = classifyRecipients([
            LITECOIN_REGTEST_BECH32,
            LITECOIN_REGTEST_BECH32.toUpperCase(),
        ], { coin: 'litecoin', network: 'regtest' });

        expect(out.valid).toEqual([LITECOIN_REGTEST_BECH32]);
        expect(out.duplicates).toBe(1);
    });

    it('publishes an uppercase bech32 paste in lowercase', () => {
        expect(classifyRecipients([MAINNET_BECH32.toUpperCase()], BTC_MAINNET).valid)
            .toEqual([MAINNET_BECH32]);
        expect(classifyRecipients(
            [LITECOIN_REGTEST_BECH32.toUpperCase()],
            { coin: 'litecoin', network: 'regtest' },
        ).valid).toEqual([LITECOIN_REGTEST_BECH32]);
        expect(classifyRecipientEntries(
            [{ value: MAINNET_BECH32.toUpperCase(), line: 1 }],
            BTC_MAINNET,
        ).valid).toEqual([MAINNET_BECH32]);
    });

    it('keeps a rejected uppercase entry as pasted', () => {
        const upper = MAINNET_BECH32.toUpperCase();
        const out = classifyRecipients([upper], BTC_REGTEST);
        expect(out.valid).toEqual([]);
        expect(out.invalid).toEqual([upper]);
    });
});

describe('bech32IdentityKey - one case-folding rule', () => {
    it('folds a single-case bech32 address of every family', () => {
        for (const address of [MAINNET_BECH32, REGTEST_BECH32, LITECOIN_BECH32, LITECOIN_REGTEST_BECH32]) {
            expect(bech32IdentityKey(address.toUpperCase())).toBe(address);
            expect(bech32IdentityKey(address)).toBe(address);
        }
    });

    it('leaves mixed-case bech32 and base58 unchanged', () => {
        const mixed = `${MAINNET_BECH32.slice(0, 10).toUpperCase()}${MAINNET_BECH32.slice(10)}`;
        expect(bech32IdentityKey(mixed)).toBe(mixed);
        expect(bech32IdentityKey(MAINNET_LEGACY)).toBe(MAINNET_LEGACY);
        expect(bech32IdentityKey(REGTEST_LEGACY)).toBe(REGTEST_LEGACY);
    });
});

describe('applyTokenAccessLists - who the network pays', () => {
    const LISTED = [MAINNET_BECH32, MAINNET_LEGACY];

    it('pays everyone when the token has no access lists', () => {
        expect(applyTokenAccessLists(LISTED, { allow: null, block: null }))
            .toEqual({ approved: LISTED, excluded: [] });
    });

    it('pays only allow-list members, and nobody for an empty allow list', () => {
        expect(applyTokenAccessLists(LISTED, { allow: [MAINNET_LEGACY] }))
            .toEqual({ approved: [MAINNET_LEGACY], excluded: [MAINNET_BECH32] });
        expect(applyTokenAccessLists(LISTED, { allow: [] }))
            .toEqual({ approved: [], excluded: LISTED });
    });

    it('never pays a block-list member, even one on the allow list', () => {
        expect(applyTokenAccessLists(LISTED, { allow: LISTED, block: [{ address: MAINNET_BECH32 }] }))
            .toEqual({ approved: [MAINNET_LEGACY], excluded: [MAINNET_BECH32] });
    });

    it('matches bech32 case variants but keeps base58 case-sensitive', () => {
        expect(applyTokenAccessLists([{ item: MAINNET_BECH32.toUpperCase() }, MAINNET_BECH32], {
            allow: [MAINNET_BECH32],
        })).toEqual({ approved: [MAINNET_BECH32.toUpperCase()], excluded: [] });
        expect(applyTokenAccessLists([MAINNET_LEGACY], { allow: [MAINNET_LEGACY.toLowerCase()] }))
            .toEqual({ approved: [], excluded: [MAINNET_LEGACY] });
    });
});

describe('reconcileStoredList - post-index count check', () => {
    it('reports the address the chain dropped', () => {
        const out = reconcileStoredList(
            [REGTEST_BECH32, REGTEST_LEGACY, MAINNET_BECH32],
            [REGTEST_BECH32, REGTEST_LEGACY],
        );
        expect(out.expectedCount).toBe(3);
        expect(out.storedCount).toBe(2);
        expect(out.missing).toEqual([MAINNET_BECH32]);
        expect(out.ok).toBe(false);
    });

    it('is quiet when the chain kept everything', () => {
        const out = reconcileStoredList(
            [REGTEST_BECH32, REGTEST_LEGACY],
            [REGTEST_BECH32, REGTEST_LEGACY],
        );
        expect(out.ok).toBe(true);
        expect(out.missing).toEqual([]);
        expect(out.storedCount).toBe(2);
    });

    it('reads row objects as well as bare strings', () => {
        const out = reconcileStoredList(
            [REGTEST_BECH32, MAINNET_BECH32],
            [{ address: REGTEST_BECH32 }, { item: REGTEST_LEGACY }],
        );
        expect(out.storedCount).toBe(2);
        expect(out.missing).toEqual([MAINNET_BECH32]);
    });

    it('matches bech32 case-insensitively but does not invent matches', () => {
        const upper = REGTEST_BECH32.toUpperCase();
        expect(reconcileStoredList([REGTEST_BECH32], [upper]).ok).toBe(true);
        expect(reconcileStoredList([REGTEST_BECH32], [REGTEST_LEGACY]).missing)
            .toEqual([REGTEST_BECH32]);
    });

    it('does not case-fold base58 addresses', () => {
        const changedCase = `${MAINNET_LEGACY.slice(0, 2)}w${MAINNET_LEGACY.slice(3)}`;
        expect(changedCase.toLowerCase()).toBe(MAINNET_LEGACY.toLowerCase());

        const out = reconcileStoredList([MAINNET_LEGACY], [changedCase]);

        expect(out.ok).toBe(false);
        expect(out.missing).toEqual([MAINNET_LEGACY]);
    });

    it('treats a missing or unreadable stored list as everything dropped', () => {
        const out = reconcileStoredList([REGTEST_BECH32], null);
        expect(out.storedCount).toBe(0);
        expect(out.missing).toEqual([REGTEST_BECH32]);
    });
});
