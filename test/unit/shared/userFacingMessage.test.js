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
    protocolRefusalReason,
    unsupportedAddressTypeMessage,
} from '../../../packages/core/src/shared/utils/userFacingMessage.js';

const FALLBACK = 'Could not import that private key.';

function protocolRefusal(reason) {
    return Object.assign(new Error(`Encoder RPC error: ${reason}`), {
        name: 'SDKEncoderError',
        code: 'ENCODER_RPC_ERROR',
    });
}

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

    it.each([
        'ERR_NETWORK',
        'E_CONN_RESET',
        'INSUFFICIENT_FUNDS',
        'Request failed: ERR_NETWORK',
        'SDKEncoderError: INSUFFICIENT_FUNDS',
    ])('keeps raw error codes and internal names out of display copy: %s', (raw) => {
        expect(userFacingMessage(raw, FALLBACK)).toBe(FALLBACK);
    });

    it.each([
        'at submitAction (submitAction.js:42:7)',
        'Could not submit\n    at submitAction (submitAction.js:42:7)',
        'submitAction.js:42:7',
    ])('keeps stack fragments out of display copy: %s', (raw) => {
        expect(userFacingMessage(raw, FALLBACK)).toBe(FALLBACK);
    });

    it.each([
        'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
        'The message port closed before a response was received.',
    ])('keeps Chrome runtime failures out of display copy: %s', (raw) => {
        expect(userFacingMessage(new Error(raw), FALLBACK)).toBe(FALLBACK);
        expect(isDeveloperMessage(raw)).toBe(true);
    });

    it.each([
        ['InvalidPasswordError', 'Incorrect password.'],
        ['HardwareSigningRetryError', 'Your hardware wallet is locked. Unlock it, then select Approve again.'],
        ['RbfPlanError', 'Already confirmed.'],
    ])('keeps the copy an app-defined %s carries', (name, message) => {
        expect(userFacingMessage(Object.assign(new Error(message), { name }), FALLBACK)).toBe(message);
    });

    it.each(['NATIVE_FEE_CHANGED', 'INPUTS_SPENT'])('keeps the sentence a wallet refusal carries under code %s', (code) => {
        const message = 'The protocol fee changed while this was on screen. Nothing was signed or sent.';
        expect(userFacingMessage(Object.assign(new Error(message), { code }), FALLBACK)).toBe(message);
    });

    it('keeps the sentence a rejected private key carries beside the SDK machine code', () => {
        const message = 'That private key is for a different network. Pick the chain the key belongs to, or paste a key for this chain.';
        const err = Object.assign(new Error(message), { name: 'InvalidWifError', code: 'NETWORK_MISMATCH' });
        expect(userFacingMessage(err, FALLBACK)).toBe(message);
        expect(isDeveloperMessage(err)).toBe(false);
    });

    it('hides platform storage exceptions, with or without their class', () => {
        expect(userFacingMessage(new DOMException('Private storage payload detail', 'QuotaExceededError'), FALLBACK))
            .toBe(FALLBACK);
        expect(userFacingMessage({ name: 'QuotaExceededError', message: 'Private storage payload detail' }, FALLBACK))
            .toBe(FALLBACK);
    });

    it('isDeveloperMessage reports the same verdict for logging callers', () => {
        expect(isDeveloperMessage(new Error('importWif: boom'))).toBe(true);
        expect(isDeveloperMessage(new Error('That is not a valid private key.'))).toBe(false);
        expect(isDeveloperMessage(undefined)).toBe(true);
    });

    it('passes through the node reason from a typed protocol refusal', () => {
        const reason = '  The market closed before this bet reached the node.  ';
        const err = protocolRefusal(reason);
        expect(protocolRefusalReason(err)).toBe(reason.trim());
        expect(userFacingMessage(err, FALLBACK)).toBe(reason.trim());
        expect(isDeveloperMessage(err)).toBe(false);
    });

    it('leaves an encoder coin-selection shortfall to the build-failure copy', () => {
        const reason = 'insufficient funds: selected inputs total 1000 but 3206 is required (outputs 2000 + fee 1206)';
        expect(protocolRefusalReason(protocolRefusal(reason))).toBeNull();
    });

    it('caps a protocol refusal reason', () => {
        const reason = 'A'.repeat(700);
        const shown = userFacingMessage(protocolRefusal(reason), FALLBACK);
        expect(shown).toBe(reason.slice(0, 500));
    });

    it.each([
        'Could not validate /RBTC/api/feequote',
        '{"error":"private detail"}',
        'Could not validate the action\n    at privateFunction (/private/source.js:1:2)',
    ])('hides unsafe content inside a typed protocol refusal: %s', (reason) => {
        const err = protocolRefusal(reason);
        expect(protocolRefusalReason(err)).toBeNull();
        expect(userFacingMessage(err, FALLBACK)).toBe(FALLBACK);
        expect(isDeveloperMessage(err)).toBe(true);
    });
});

describe('userFacingMessage for an address type the SDK does not know', () => {
    const FALLBACK_UNLOCK = 'Could not generate addresses. Make sure the wallet is unlocked or your hardware device is connected.';

    it('names the address type instead of the generic fallback', () => {
        const err = Object.assign(
            new Error('Unknown address type: "p2tr". Supported: p2pkh, p2wpkh, p2sh-p2wpkh'),
            { name: 'SDKWalletError', code: 'INVALID_ADDRESS_TYPE' },
        );
        const message = userFacingMessage(err, FALLBACK_UNLOCK);
        expect(message).toBe('This address type is not available yet. Choose another address type.');
        expect(message).not.toMatch(/unlocked/i);
    });

    it('recognises the refusal after a messaging hop strips the code', () => {
        expect(userFacingMessage(new Error('Unknown address type: "p2tr".'), FALLBACK_UNLOCK))
            .toMatch(/not available yet/);
    });

    it('leaves other errors on their own fallback', () => {
        expect(userFacingMessage(new Error('device disconnected'), FALLBACK_UNLOCK))
            .toBe('device disconnected');
        expect(unsupportedAddressTypeMessage(new Error('wallet.unlock: bad password'))).toBeNull();
    });
});
