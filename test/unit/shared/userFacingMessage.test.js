// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// D-52 / D-64: forms that do `setError(err.message)` show the user whatever
// the flow or the host threw, including precondition strings prefixed with a
// function name. This is the reusable filter, so the next screen does not
// have to remember. It must PASS user copy through untouched - a flow that
// already words its rejection well keeps its wording.

import { describe, it, expect } from 'vitest';
import {
    userFacingMessage,
    isDeveloperMessage,
} from '../../../packages/core/src/shared/utils/userFacingMessage.js';

const FALLBACK = 'Could not import that private key.';

describe('userFacingMessage', () => {
    it('replaces a flow precondition string', () => {
        expect(userFacingMessage(new Error('importWif: walletId is required'), FALLBACK))
            .toBe(FALLBACK);
    });

    it('replaces a namespaced host error', () => {
        expect(userFacingMessage(new Error('addresses.newest: unknown chain "x"'), FALLBACK))
            .toBe(FALLBACK);
        expect(userFacingMessage(new Error('wallet.import: a wallet already exists'), FALLBACK))
            .toBe(FALLBACK);
    });

    it('replaces a bare library internal with no prefix at all', () => {
        expect(userFacingMessage(new Error('Non-base58 character'), FALLBACK)).toBe(FALLBACK);
        expect(userFacingMessage(new TypeError('Cannot read properties of undefined'), FALLBACK))
            .toBe(FALLBACK);
    });

    it('replaces an empty or absent message', () => {
        expect(userFacingMessage(new Error(''), FALLBACK)).toBe(FALLBACK);
        expect(userFacingMessage(undefined, FALLBACK)).toBe(FALLBACK);
        expect(userFacingMessage(null, FALLBACK)).toBe(FALLBACK);
        expect(userFacingMessage({}, FALLBACK)).toBe(FALLBACK);
    });

    it('passes house copy through unchanged', () => {
        // The whole point: a flow that says the right thing keeps saying it,
        // rather than being flattened into a generic fallback.
        const good = 'That private key is for a different network. Pick the chain the key belongs to.';
        expect(userFacingMessage(new Error(good), FALLBACK)).toBe(good);
        expect(userFacingMessage(
            new Error('This private key is already in this wallet (mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp).'),
            FALLBACK,
        )).toMatch(/already in this wallet/);
    });

    it('does not mistake ordinary prose with a colon for a function prefix', () => {
        // "Note: ..." and "Warning: ..." are copy, not stack traces; the
        // prefix rule is anchored on a lowercase, space-free identifier.
        const note = 'Note: this key is not covered by your recovery phrase.';
        expect(userFacingMessage(new Error(note), FALLBACK)).toBe(note);
        const two = 'One address, two records: the balance was counted twice.';
        expect(userFacingMessage(new Error(two), FALLBACK)).toBe(two);
    });

    it('accepts a plain string as well as an Error', () => {
        expect(userFacingMessage('importWif: nope', FALLBACK)).toBe(FALLBACK);
        expect(userFacingMessage('That password is not correct.', FALLBACK))
            .toBe('That password is not correct.');
    });

    it('trims before deciding, so leading whitespace cannot smuggle a prefix through', () => {
        expect(userFacingMessage(new Error('   importWif: boom'), FALLBACK)).toBe(FALLBACK);
    });

    it('isDeveloperMessage reports the same verdict for logging callers', () => {
        expect(isDeveloperMessage(new Error('importWif: boom'))).toBe(true);
        expect(isDeveloperMessage(new Error('That is not a valid private key.'))).toBe(false);
        expect(isDeveloperMessage(undefined)).toBe(true);
    });
});
