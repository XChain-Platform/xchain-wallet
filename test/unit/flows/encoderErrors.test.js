// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every SDK encoder code must reach the user as a sentence, not as the
// wire wording. The live finding was a DOGE address with no DOGE being told
// "no spendable UTXOs found for the funding address".

import { describe, it, expect } from 'vitest';
import {
    encoderErrorCode,
    encoderErrorDetails,
    isEncoderError,
    encoderErrorMessage,
    annotateEncoderFeeRequirement,
} from '../../../packages/core/src/sdk/encoderErrors.js';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import {
    BROADCAST_FAILED_TRANSIENT_NAME,
    BROADCAST_FAILED_PERMANENT_NAME,
} from '../../../packages/core/src/flows/broadcastPermanence.js';
import { NativeFeeForfeitError } from '../../../packages/core/src/sdk/nativeFeePreflight.js';

// The SDK's own error shape (xchain-sdk src/errors.js).
function sdkEncoderError(code, message, details = {}) {
    const err = new Error(message);
    err.name = 'SDKEncoderError';
    err.code = code;
    err.details = details;
    return err;
}

// What a form in the popup actually catches: MessageHost.serializeError keeps
// only { name, message }, so `code` and `details` are gone.
function acrossBoundary(err) {
    const wire = { name: err.name, message: err.message };
    const revived = new Error(wire.message);
    revived.name = wire.name;
    return revived;
}

// Every throw site in xchain-sdk src/encoder.js, by code and by its message.
const THROW_SITES = [
    ['NO_UTXOS', 'no spendable UTXOs found for the funding address'],
    ['UTXO_TRACKER_STALE', 'utxo-tracker view is not synced; refusing to select utxos from it'],
    ['MISSING_PUBKEY', 'createTx requires pubkey'],
    ['MISSING_PUBKEY', 'spendP2sh requires pubkey'],
    ['MISSING_P2SH_HASH', 'spendP2sh requires p2shHash'],
    ['MISSING_P2SH_HEX', 'spendP2sh requires p2shHex'],
    ['MISSING_TX_HEX', 'broadcastTx requires txHex (signed transaction hex)'],
    ['MISSING_ADDRESS', 'getUTXOs requires address'],
    ['MISSING_DATA', 'createTx requires data (ACTION string), rawData, or customOutputs (payment-only)'],
    ['ENCODER_TIMEOUT', 'Encoder request timed out'],
    ['ENCODER_NETWORK', 'Encoder request failed: socket hang up'],
    ['ENCODER_HTTP_503', 'Encoder returned HTTP 503 for method create_tx'],
    ['ENCODER_HTTP_400', 'Encoder returned HTTP 400 for method create_tx'],
    ['ENCODER_RPC_ERROR', 'Encoder RPC error: insufficient funds in the funding set'],
];

describe('encoderErrorCode', () => {
    it('reads the code off the error when it survived', () => {
        for (const [code, message] of THROW_SITES) {
            expect(encoderErrorCode(sdkEncoderError(code, message))).toBe(code);
        }
    });

    it('recovers the code from the message after the messaging boundary dropped it', () => {
        for (const [code, message] of THROW_SITES) {
            const wire = acrossBoundary(sdkEncoderError(code, message));
            expect(wire.code).toBeUndefined();
            expect(encoderErrorCode(wire)).toBe(code);
        }
    });

    it('is null for anything that is not an encoder failure', () => {
        expect(encoderErrorCode(null)).toBeNull();
        expect(encoderErrorCode(new Error('Incorrect password.'))).toBeNull();
        // A raw axios error carries a `code` too; it is not one the SDK mints.
        const axiosish = new Error('connect ECONNREFUSED');
        axiosish.code = 'ECONNREFUSED';
        expect(encoderErrorCode(axiosish)).toBeNull();
    });
});

describe('isEncoderError', () => {
    it('recognises the SDK class by name even with an unmapped message', () => {
        const err = new Error('something new the SDK started saying');
        err.name = 'SDKEncoderError';
        expect(isEncoderError(err)).toBe(true);
    });

    it('is false for unrelated errors', () => {
        expect(isEncoderError(new Error('Incorrect password.'))).toBe(false);
        expect(isEncoderError(undefined)).toBe(false);
    });
});

describe('encoderErrorMessage', () => {
    const CURRENT_RPC_REFUSALS = [
        'Payload too large: compiled size 9000 bytes exceeds maximum 8192 bytes (compiled on-chain ACTION push)',
        'Transaction would burn significant satoshis as fees. Please provide a change address.',
        'Node did not report a positive relayfee; transaction fee safety cannot be verified',
        'fee 19 is below the node relay minimum 20 base units for a ~190-byte transaction',
        'feePerKb 100 base units/kB produces fee 19, below the node relay minimum 20 base units for a ~190-byte transaction',
        'fee 90000 exceeds the maximum allowed 20000 satoshis for a ~200-byte transaction (fee-rate cap)',
        'fee 90000 exceeds 100x the estimated fair fee (800 satoshis) for a ~200-byte transaction',
        'selected input count (701) exceeds the maximum (700) inputs for a single transaction',
        'input selection raced a concurrent reservation: the obfuscation key is bound to an outpoint that is not the first input; retry the request',
        'refusing to rebuild a transaction identical to one built in the last 5 minutes (same inputs and outputs, same txid abc); broadcast the one you already have, or change the inputs or outputs',
        'OP_RETURN encoding requires compiled payload <= 80 bytes; got 120. Use P2SH for larger payloads.',
    ];

    it('keeps the specifics in every current encoder refusal', () => {
        for (const reason of CURRENT_RPC_REFUSALS) {
            const raw = `Encoder RPC error: ${reason}`;
            const copy = encoderErrorMessage(sdkEncoderError('ENCODER_RPC_ERROR', raw), {});
            expect(copy, reason).toContain(reason);
            expect(copy, reason).not.toContain('Encoder RPC error:');
        }
    });

    it('maps every throw site to a sentence, and never leaks the wire wording', () => {
        for (const [code, message] of THROW_SITES) {
            const copy = encoderErrorMessage(sdkEncoderError(code, message), { coinTicker: 'DOGE' });
            expect(copy, code).toBeTruthy();
            expect(copy, code).not.toBe(message);
            // The whole point of the item: no protocol jargon reaches the user.
            // The quoted bug-report token is deliberate and exempt: it is the
            // one place a code is shown, and it is shown AS a code to quote.
            const prose = copy.replace(/quoting "[A-Z0-9_]+"/, 'quoting a code');
            expect(prose, code).not.toMatch(/utxo/i);
            expect(prose, code).not.toMatch(/pubkey|p2sh|txHex|rawData|createTx|spendP2sh|getUTXOs/i);
            // A sentence, not a fragment.
            expect(copy.trim(), code).toMatch(/[.]$/);
        }
    });

    it('names the coin, the shortfall and the remedy for an unfunded address', () => {
        const err = sdkEncoderError('NO_UTXOS', 'no spendable UTXOs found for the funding address', {
            address: 'nXCHAINexampleaddress',
        });
        const copy = encoderErrorMessage(err, { coinTicker: 'DOGE', requiredNative: '20.00000000' });
        expect(copy).toContain('DOGE');
        expect(copy).toContain('20 DOGE');
        expect(copy).toMatch(/add doge to this address/i);
        expect(copy).not.toMatch(/utxo/i);
    });

    it('still gives usable copy for an unfunded address when no quote is known', () => {
        const copy = encoderErrorMessage(
            sdkEncoderError('NO_UTXOS', 'no spendable UTXOs found for the funding address'),
            { coinTicker: 'BTC' },
        );
        expect(copy).toContain('BTC');
        expect(copy).not.toMatch(/about undefined|NaN|null/);
    });

    it('reads the amount back off an error that crossed the messaging boundary', () => {
        const err = annotateEncoderFeeRequirement(
            sdkEncoderError('NO_UTXOS', 'no spendable UTXOs found for the funding address'),
            { requiredFeeNative: '20.00000000' },
        );
        const copy = encoderErrorMessage(acrossBoundary(err), { coinTicker: 'DOGE' });
        expect(copy).toContain('20 DOGE');
    });

    it('blames the service, not the user, for a stale tracker', () => {
        const copy = encoderErrorMessage(
            sdkEncoderError('UTXO_TRACKER_STALE', 'utxo-tracker view is not synced; refusing to select utxos from it'),
            { coinTicker: 'DOGE' },
        );
        expect(copy).toMatch(/not a problem with your wallet or your address/i);
        expect(copy).toMatch(/nothing was signed or sent/i);
        expect(copy).not.toMatch(/utxo/i);
    });

    it('tells the user a missing-field failure is the wallet\'s fault, with the code to quote', () => {
        const copy = encoderErrorMessage(sdkEncoderError('MISSING_PUBKEY', 'createTx requires pubkey'), {});
        expect(copy).toMatch(/fault in the wallet/i);
        expect(copy).toContain('MISSING_PUBKEY');
    });

    it('separates a retryable service outage from a refused request', () => {
        const outage = encoderErrorMessage(
            sdkEncoderError('ENCODER_HTTP_503', 'Encoder returned HTTP 503 for method create_tx'), {});
        const refused = encoderErrorMessage(
            sdkEncoderError('ENCODER_HTTP_400', 'Encoder returned HTTP 400 for method create_tx'), {});
        expect(outage).toMatch(/try again in a moment/i);
        expect(refused).toMatch(/refused this request/i);
        expect(refused).not.toMatch(/try again in a moment/i);
    });

    it('passes the service reason through on an RPC error, without the developer prefix', () => {
        const copy = encoderErrorMessage(
            sdkEncoderError('ENCODER_RPC_ERROR', 'Encoder RPC error: insufficient funds in the funding set'), {});
        expect(copy).toContain('insufficient funds in the funding set');
        expect(copy).not.toContain('Encoder RPC error:');
    });

    it('uses safe generic copy for an unknown RPC refusal and unknown SDK message', () => {
        const rpc = encoderErrorMessage(
            sdkEncoderError('ENCODER_RPC_ERROR', 'Encoder RPC error: future internal refusal'), {});
        const future = new Error('future SDK wording');
        future.name = 'SDKEncoderError';
        expect(rpc).toMatch(/could not be built/i);
        expect(rpc).not.toContain('future internal refusal');
        expect(encoderErrorMessage(future, {})).toMatch(/transaction service could not complete/i);
        expect(encoderErrorMessage(future, {})).not.toContain('future SDK wording');
        expect(encoderErrorDetails(future)).toBe('future SDK wording');
    });

    it('hides the encoder service\'s uninformative internal error', () => {
        const raw = 'Encoder RPC error: Internal encoder error';
        const copy = encoderErrorMessage(sdkEncoderError('ENCODER_RPC_ERROR', raw), {});
        expect(copy).toBe('This transaction could not be built. Nothing was signed or sent, so nothing was spent.');
        expect(copy).not.toContain('Internal encoder error');
    });

    it('has a safe answer for an ENCODER_* code minted after this mapper', () => {
        const copy = encoderErrorMessage(sdkEncoderError('ENCODER_QUANTUM_FLUX', 'Encoder went sideways'), {});
        expect(copy).toMatch(/nothing was signed or sent/i);
        expect(copy).not.toContain('sideways');
    });

    it('returns null for a non-encoder error so the caller keeps its own copy', () => {
        expect(encoderErrorMessage(new Error('Incorrect password.'), {})).toBeNull();
    });
});

describe('annotateEncoderFeeRequirement', () => {
    it('is a no-op without a quote, without an amount, and on a non-encoder error', () => {
        const bare = sdkEncoderError('NO_UTXOS', 'no spendable UTXOs found for the funding address');
        expect(annotateEncoderFeeRequirement(bare, null).message).toBe(
            'no spendable UTXOs found for the funding address');
        expect(annotateEncoderFeeRequirement(bare, { requiredFeeNative: '0.00000000' }).message).toBe(
            'no spendable UTXOs found for the funding address');
        const other = new Error('Incorrect password.');
        expect(annotateEncoderFeeRequirement(other, { requiredFeeNative: '20' }).message)
            .toBe('Incorrect password.');
    });

    it('stamps once, so a re-thrown error does not accumulate suffixes', () => {
        let err = sdkEncoderError('NO_UTXOS', 'no spendable UTXOs found for the funding address');
        err = annotateEncoderFeeRequirement(err, { requiredFeeNative: '20.00000000' });
        err = annotateEncoderFeeRequirement(err, { requiredFeeNative: '20.00000000' });
        expect(err.message.match(/protocol fee requires/g)).toHaveLength(1);
    });
});

describe('submitFailureMessage adopts the encoder mapper', () => {
    it('translates the live failure instead of showing the fallback', () => {
        const err = annotateEncoderFeeRequirement(
            sdkEncoderError('NO_UTXOS', 'no spendable UTXOs found for the funding address'),
            { requiredFeeNative: '20.00000000' },
        );
        const copy = submitFailureMessage(err, {
            coinTicker: 'DOGE', mandatory: true, fallback: 'Create token failed.',
        });
        expect(copy).toContain('20 DOGE');
        expect(copy).not.toMatch(/utxo/i);
        expect(copy).not.toBe('Create token failed.');
    });

    it('takes an explicit requiredNative from a caller that holds the quote', () => {
        const copy = submitFailureMessage(
            sdkEncoderError('NO_UTXOS', 'no spendable UTXOs found for the funding address'),
            { coinTicker: 'LTC', requiredNative: '0.05000000' },
        );
        expect(copy).toContain('0.05 LTC');
    });

    it('leaves the native-fee refusal and the signed-but-queued branches alone', () => {
        const forfeit = new NativeFeeForfeitError({ reason: 'dust', quote: { requiredFeeNative: '0.00002' } });
        expect(submitFailureMessage(forfeit, { coinTicker: 'BTC' })).toMatch(/too small to send/i);

        const queued = new Error('broadcast failed: ECONNREFUSED');
        queued.name = BROADCAST_FAILED_TRANSIENT_NAME;
        expect(submitFailureMessage(queued, { coinTicker: 'BTC' })).toMatch(/queued/i);
    });

    it('does not relabel a permanent broadcast failure that quotes an encoder message', () => {
        // The signed transaction is dead; the form's own re-compose copy must win,
        // and it must not be reworded as "nothing was signed or sent".
        const dead = new Error('broadcast failed: Encoder RPC error: bad-txns-inputs-missingorspent');
        dead.name = BROADCAST_FAILED_PERMANENT_NAME;
        const copy = submitFailureMessage(dead, { coinTicker: 'BTC', fallback: 'Send failed.' });
        expect(copy).toBe('Send failed.');
    });

    it('still falls through to the caller copy for an unrelated error', () => {
        expect(submitFailureMessage(new Error('boom'), { fallback: 'Mint failed.' })).toBe('Mint failed.');
    });

    it('humanizes a raw caller fallback instead of displaying it', () => {
        const err = new Error('internal refusal');
        const copy = submitFailureMessage(err, { fallback: err.message });
        expect(copy).toBe("Couldn't complete this. Something went wrong. Try again.");
        expect(copy).not.toContain('internal refusal');
    });

    it('keeps a form-authored opener when its fallback includes the raw error', () => {
        const err = new Error('sendToken: params.TICK is required');
        const fallback = `Couldn't mint. ${err.message}`;
        expect(submitFailureMessage(err, { fallback })).toBe(fallback);
    });

    it('humanizes a connection error when the fallback is exactly the raw text', () => {
        const err = new Error('ECONNREFUSED');
        expect(submitFailureMessage(err, { fallback: err.message }))
            .toBe("Couldn't complete this. The network is unreachable. Check your connection and try again.");
    });
});
