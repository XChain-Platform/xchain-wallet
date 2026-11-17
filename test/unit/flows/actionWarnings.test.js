// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The confirm screen's consequence-warning registry (operator ruling
// 2026-11-14): which parsed actions carry which warning ids, and that every
// line the registry names has English copy.

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import {
    ACTION_WARNINGS,
    ACTION_WARNING_TITLES,
    actionWarningIds,
    actionWarningKeys,
    actionWarningLines,
    actionWarningTitle,
    withoutCoveredWarnings,
} from '../../../packages/core/src/flows/actionWarnings.js';
import actionWarningsCopy from '../../../packages/core/src/i18n/locales/en/actionWarnings.js';

// The SDK's own parser and describer (what sdk.decoder.parse and describe
// expose), loaded on their own so this suite does not load the SDK index,
// which also loads key derivation and its ecc check; that check failed this
// suite in a full unit run while passing alone.
const sdkRequire = createRequire(import.meta.url);
const { parse: sdkParse } = sdkRequire('../../../node_modules/xchain-sdk/src/decoder/parse.js');
const { describe: sdkDescribe } = sdkRequire('../../../node_modules/xchain-sdk/src/decoder/describe.js');

describe('actionWarningIds', () => {
    it.each([
        ['LIST transfer', { action: 'LIST', version: 3, params: { LIST_ACTION_INDEX: '7', DESTINATION: 'bc1q' } }, ['LIST_TRANSFER']],
        ['LIST share', { action: 'LIST', version: 2, params: { LIST_ACTION_INDEX: '7' } }, ['LIST_SHARE']],
        ['token ownership transfer', { action: 'ISSUE', version: 0, params: { TICK: 'JDOG', TRANSFER: 'bc1qnew' } }, ['TOKEN_OWNERSHIP_TRANSFER']],
        ['token lock', { action: 'ISSUE', version: 3, params: { TICK: 'JDOG', LOCK_MINT: '1' } }, ['TOKEN_LOCK']],
        ['DESTROY', { action: 'DESTROY', version: 0, params: { TICK: 'JDOG', AMOUNT: '1' } }, ['DESTROY']],
        ['address lock', { action: 'SLEEP', version: 0, params: { RESUME_BLOCK: '900' } }, ['ADDRESS_LOCK']],
        ['token pause', { action: 'SLEEP', version: 1, params: { TICK: 'JDOG', RESUME_BLOCK: '900' } }, ['TOKEN_PAUSE']],
        ['SWEEP', { action: 'SWEEP', version: 0, params: { DESTINATION: 'bc1q' } }, ['SWEEP']],
        ['controller bind', { action: 'ADDRESS', version: 1, params: { CONTROLLER: '4', ACTION_CLASS: 'transfer' } }, ['CONTROLLER_BIND']],
        ['controller unbind', { action: 'ADDRESS', version: 1, params: { UNBIND: '1', ACTION_CLASS: 'transfer' } }, ['CONTROLLER_UNBIND']],
        ['dispenser close', { action: 'DISPENSER', version: 1, params: { DISPENSER_ACTION_INDEX: '9' } }, ['DISPENSER_CLOSE']],
        ['delegation clear', { action: 'VOTE', version: 3, params: { TICK: 'JDOG', DELEGATE_TO: '' } }, ['DELEGATION_CLEAR']],
        ['CALLBACK', { action: 'CALLBACK', version: 0, params: { TICK: 'JDOG' } }, ['CALLBACK']],
        ['market create', { action: 'BET', version: 0, params: { label: 'Who wins?' } }, ['MARKET_CREATE']],
        ['market resolve', { action: 'BET', version: 3, params: {} }, ['MARKET_RESOLVE']],
        ['market cancel', { action: 'BET', version: 1, params: {} }, ['MARKET_CANCEL']],
        ['bridge move', { action: 'XBRIDGE', version: 0, params: {} }, ['BRIDGE_MOVE']],
    ])('names %s', (_name, parsed, expected) => {
        expect(actionWarningIds(parsed)).toEqual(expected);
    });

    it.each([
        ['a plain send', { action: 'SEND', version: 0, params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'bc1q' } }],
        ['a list create', { action: 'LIST', version: 0, params: { TYPE: '1', ITEM: ['JDOG'] } }],
        ['a resume', { action: 'SLEEP', version: 0, params: { RESUME_BLOCK: '0' } }],
        ['a delegation set', { action: 'VOTE', version: 3, params: { TICK: 'JDOG', DELEGATE_TO: 'bc1q' } }],
        ['a token create with no transfer or lock', { action: 'ISSUE', version: 0, params: { TICK: 'JDOG', MAX_SUPPLY: '10' } }],
        ['nothing parsed', null],
    ])('names nothing for %s', (_name, parsed) => {
        expect(actionWarningIds(parsed)).toEqual([]);
    });

    // The host feeds the classifier the SDK's own parse, whose version is a
    // number and whose params carry no VERSION, so the seam is pinned on it.
    it.each([
        ['LIST|3|7|bc1qexample', ['LIST_TRANSFER']],
        ['LIST|2|7', ['LIST_SHARE']],
        ['ADDRESS|1|4|transfer|10|1', ['CONTROLLER_UNBIND']],
        ['ADDRESS|1|4|transfer|10|', ['CONTROLLER_BIND']],
        ['SEND|0|JDOG|1|bc1q', []],
        // A cancel's warning is the card's alone: the SDK describer says no cancel line.
        ['ORDER|1|42', ['ORDER_CANCEL']],
        ['SWAP|1|812', ['SWAP_CANCEL']],
    ])('classifies the SDK parse of %s', (actionString, expected) => {
        const parsed = sdkParse(actionString);
        expect(parsed.ok).toBe(true);
        expect(actionWarningIds(parsed)).toEqual(expected);
    });

    it('reads the version from params when the parse carries none', () => {
        expect(actionWarningIds({ action: 'LIST', params: { VERSION: '3' } })).toEqual(['LIST_TRANSFER']);
    });

    // Cancel Order and Cancel Swap say what a cancel does on the review
    // screen (G105), not on the form; an edit or a create says nothing.
    it.each([
        [{ action: 'ORDER', version: 1, params: { ORDER_ACTION_INDEX: '700' } }, ['ORDER_CANCEL']],
        [{ action: 'ORDER', params: { VERSION: '1', ORDER_ACTION_INDEX: '700' } }, ['ORDER_CANCEL']],
        [{ action: 'ORDER', version: 2, params: { ORDER_ACTION_INDEX: '700', EXPIRATION: '1' } }, []],
        [{ action: 'ORDER', version: 0, params: {} }, []],
        [{ action: 'SWAP', version: 1, params: { SWAP_ACTION_INDEX: '812' } }, ['SWAP_CANCEL']],
        [{ action: 'SWAP', version: 2, params: { SWAP_ACTION_INDEX: '812' } }, []],
    ])('classifies an order or swap cancel: %o', (parsed, expected) => {
        expect(actionWarningIds(parsed)).toEqual(expected);
    });

    it('words the order cancel so it holds for a native-coin give, which escrows nothing', () => {
        expect(actionWarningTitle(['ORDER_CANCEL'])).toBe('Cancelling closes the order');
        expect(actionWarningLines(['ORDER_CANCEL']).map((item) => item.text)).toEqual([
            'Any escrowed side returns to you.',
        ]);
        expect(actionWarningTitle(['SWAP_CANCEL'])).toBe('Cancelling closes the swap offer');
        expect(actionWarningLines(['SWAP_CANCEL']).map((item) => item.text)).toEqual([
            'The escrowed side returns to you.',
        ]);
    });
});

describe('ACTION_WARNINGS registry', () => {
    it('gives every line English copy', () => {
        for (const rows of Object.values(ACTION_WARNINGS)) {
            for (const row of rows) expect(actionWarningsCopy[row.labelKey], row.labelKey).toBeTruthy();
        }
    });

    // G127 revised 2026-11-16: the confirm's short warning is a bold title
    // plus one line; longer explanations live on the forms.
    it('gives every kind a title and exactly one short line', () => {
        expect(Object.keys(ACTION_WARNING_TITLES).sort()).toEqual(Object.keys(ACTION_WARNINGS).sort());
        for (const [id, rows] of Object.entries(ACTION_WARNINGS)) {
            expect(actionWarningsCopy[ACTION_WARNING_TITLES[id].labelKey], id).toBeTruthy();
            expect(rows.length, id).toBe(1);
            for (const row of rows) expect(actionWarningsCopy[row.labelKey].length, row.labelKey).toBeLessThanOrEqual(90);
        }
    });

    it('titles a multi-id action by its first id and keeps every id\'s lines', () => {
        expect(actionWarningTitle(['TOKEN_OWNERSHIP_TRANSFER', 'TOKEN_LOCK'])).toBe("You can't undo this");
        expect(actionWarningTitle(['NOPE', 'LIST_SHARE'])).toBe('Sharing is permanent');
        expect(actionWarningTitle(['NOPE'])).toBeNull();
        expect(actionWarningLines(['TOKEN_OWNERSHIP_TRANSFER', 'TOKEN_LOCK']).map((item) => item.text)).toEqual([
            'After it confirms, only the new owner can administer this token.',
            'A locked setting can never be changed again.',
        ]);
    });

    it('keeps the LIST transfer warning to a title and one short line', () => {
        expect(actionWarningTitle(['LIST_TRANSFER'])).toBe("You can't undo this");
        expect(actionWarningLines(['LIST_TRANSFER']).map((item) => item.text)).toEqual([
            'The new owner controls this list from this block on.',
        ]);
    });

    it('keeps the most important address-lock and pause line', () => {
        expect(actionWarningTitle(['ADDRESS_LOCK'])).toBe('This address will be locked');
        expect(actionWarningLines(['ADDRESS_LOCK']).map((item) => item.text)).toEqual([
            'Nothing can lift the lock before its resume block.',
        ]);
        expect(actionWarningLines(['TOKEN_PAUSE']).map((item) => item.text)).toEqual([
            'New XChain actions with this token are rejected until the resume block.',
        ]);
        expect(actionWarningLines(['MARKET_CREATE']).map((item) => item.text)).toEqual([
            "You're the oracle: resolve or cancel it, or bettors are refunded on your public record.",
        ]);
    });

    it('drops unknown ids and repeated lines', () => {
        expect(actionWarningKeys(['DESTROY', 'NOPE', 'DESTROY'])).toEqual(['actionWarnings.destroy.permanent']);
        expect(actionWarningKeys(undefined)).toEqual([]);
    });
});

describe('withoutCoveredWarnings', () => {
    const DEST = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    // The confirm screen's lines come from the SDK's describer
    // (composeActionForConfirm), so each case runs the real parse and
    // describe and expects the card to leave no line of its own behind.
    it.each([
        ['DESTROY|0|JDOG|1|', ['DESTROY']],
        ['SLEEP|0|900|', ['ADDRESS_LOCK']],
        ['SLEEP|1|900|JDOG|', ['TOKEN_PAUSE']],
        [`SWEEP|0|${DEST}|`, ['SWEEP']],
        ['CALLBACK|0|JDOG|', ['CALLBACK']],
        ['LIST|3|7|' + DEST + '|', ['LIST_TRANSFER']],
        ['ISSUE|0|JDOG|||||||||' + DEST, ['TOKEN_LOCK']],
        ['ADDRESS|1|4|transfer|10|', ['CONTROLLER_BIND']],
        ['ADDRESS|1|4|transfer|10|1', ['CONTROLLER_UNBIND']],
        ['DISPENSER|1|9|', ['DISPENSER_CLOSE']],
        ['BET|0|Who wins?|Yes,No|JDOG|0|1900000000|86400|||', ['MARKET_CREATE']],
        ['BET|3|5|1|', ['MARKET_RESOLVE']],
        ['BET|1|5|', ['MARKET_CANCEL']],
        [`XBRIDGE|1|JDOG|1|${DEST}|`, ['BRIDGE_MOVE']],
    ])('leaves no describer line the card says for %s', (actionString, ids) => {
        const parsed = sdkParse(actionString);
        expect(parsed.ok).toBe(true);
        expect(actionWarningIds(parsed)).toEqual(ids);
        const warnings = sdkDescribe(parsed, {}).warnings;
        expect(warnings.length).toBeGreaterThan(0);
        expect(withoutCoveredWarnings(warnings, ids)).toEqual([]);
    });

    it('drops the share fee line, which the Protocol fee row states without a protocol key', () => {
        const parsed = sdkParse('LIST|2|7|');
        expect(withoutCoveredWarnings(sdkDescribe(parsed, {}).warnings, ['LIST_SHARE']))
            .toEqual([]);
    });

    it('keeps the lint lines and drops the wallet decoder spelling too', () => {
        expect(withoutCoveredWarnings([
            'While locked, this address cannot send anything, including a wake-up.',
            'Memo contains | or ;: the protocol will reject this transaction.',
        ], ['ADDRESS_LOCK'])).toEqual(['Memo contains | or ;: the protocol will reject this transaction.']);
    });

    it('keeps every line when no card shows', () => {
        const lines = ['Destroying is irreversible. The tokens cannot be recovered.'];
        expect(withoutCoveredWarnings(lines, [])).toEqual(lines);
        expect(withoutCoveredWarnings(lines, ['SWEEP'])).toEqual(lines);
        expect(withoutCoveredWarnings(undefined, ['DESTROY'])).toEqual([]);
    });
});
