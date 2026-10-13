import { describe, expect, it } from 'vitest';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import {
    isDeveloperMessage,
    userFacingMessage,
} from '../../../packages/core/src/shared/utils/userFacingMessage.js';

function codedError(name, code, message, fields = {}) {
    return Object.assign(new Error(message), { name, code, ...fields });
}

const NEXT_STEP = /add|check|choose|enter|give|reconnect|report|retry|review|try again|update|wait/i;
const PRIVATE_TEXT = /\/RBTC\/api|feequote|https:\/\/private|\n\s*at\s|\{"token"/i;
const CODE_IDENTIFIER = /\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/;
const STACK_OR_URL = /https?:\/\/|www\.|\/(?:[A-Za-z0-9_-]+\/)*api(?:\/|\b)|\n\s*at\s+\S+|\b(?:TypeError|ReferenceError):/i;

describe('submitFailureMessage SDK error map', () => {
    const unsafe = 'privateFunction: request failed for https://private.example/RBTC/api/feequote';
    const cases = [
        ['hub unavailable by code', codedError('Error', 'HUB_UNAVAILABLE', unsafe)],
        ['hub error', codedError('SDKHubError', 'HUB_NOT_CONFIGURED', unsafe)],
        ['SDK configuration', codedError('SDKConfigError', 'CONFIG_INVALID', unsafe)],
        ['validation', codedError('SDKValidationError', 'BATCH_CONSTRAINT',
            'betting.placeBetParams: amount must be a positive stake')],
        ['format', codedError('SDKFormatError', 'UNKNOWN_ACTION', unsafe)],
        ['contract', codedError('SDKContractError', 'CONTRACT_LINT_FAILED', unsafe)],
        ['wallet', codedError('SDKWalletError', 'INVALID_PSBT', unsafe)],
        ['authorization', codedError('SDKAuthError', 'INVALID_WIF', unsafe)],
        ['messaging', codedError('SDKMessagingError', 'INVALID_MESSAGE', unsafe)],
        ['action', codedError('SDKActionError', 'ACTION_REJECTED', unsafe)],
        ['shared signature', codedError('SDKMuSigError', 'SIGN_FAILED', unsafe)],
        ['protected file', codedError('SDKGatedFileError', 'INVALID_PAYLOAD', unsafe)],
        ['compression', codedError('SDKCompressionError', 'INPUT_TOO_LARGE', unsafe)],
        ['policy', codedError('SDKPolicyError', 'POLICY_DENIED', unsafe)],
        ['service payment', codedError('SDKX402Error', 'X402_PAYMENT_NOT_FOUND', unsafe)],
        ['preflight', codedError('SDKPreflightError', 'PREFLIGHT_FAIL', unsafe)],
        ['generic rate limit', codedError('SDKRateLimitedError', 'RATE_LIMITED', unsafe)],
        ['base SDK error', codedError('SDKError', 'SOMETHING_NEW', unsafe)],
        ['oracle fee', codedError('OracleFeeUnpayableError', undefined, unsafe)],
        ['non-finite amount', codedError('Error', 'NON_FINITE_AMOUNT', unsafe)],
        ['invalid satoshi amount', codedError('Error', 'INVALID_SATS_AMOUNT', unsafe)],
        ['unknown chain', codedError('UnknownChainError', undefined, unsafe)],
        ['refused reveal inputs', codedError('Error', 'REVEAL_INPUTS_REFUSED', unsafe)],

        ['no spendable coin', codedError('SDKEncoderError', 'NO_UTXOS', unsafe), { coinTicker: 'BTC' }],
        ['stale spendable balance', codedError('SDKEncoderError', 'UTXO_TRACKER_STALE', unsafe)],
        ...['MISSING_PUBKEY', 'MISSING_ADDRESS', 'MISSING_DATA', 'MISSING_TX_HEX',
            'MISSING_P2SH_HASH', 'MISSING_P2SH_HEX']
            .map((code) => [`incomplete encoder request ${code}`, codedError('SDKEncoderError', code, unsafe)]),
        ['encoder timeout', codedError('SDKEncoderError', 'ENCODER_TIMEOUT', unsafe)],
        ['encoder network', codedError('SDKEncoderError', 'ENCODER_NETWORK', unsafe)],
        ['encoder old rate limit', codedError('SDKEncoderError', 'ENCODER_HTTP_429', unsafe)],
        ['encoder rate limit', codedError('SDKRateLimitedError', 'RATE_LIMITED', unsafe,
            { service: 'encoder', retryAfterSeconds: 12 })],
        ['encoder refusal', codedError('SDKEncoderError', 'ENCODER_HTTP_400', unsafe)],
        ['encoder outage', codedError('SDKEncoderError', 'ENCODER_HTTP_503', unsafe)],
        ['encoder RPC', codedError('SDKEncoderError', 'ENCODER_RPC_ERROR', 'internal encoder error')],

        ['bad fee quote', codedError('SDKExplorerError', 'EXPLORER_BAD_FEEQUOTE', unsafe)],
        ['explorer old rate limit', codedError('SDKExplorerError', 'EXPLORER_HTTP_429', unsafe)],
        ['explorer rate limit', codedError('SDKRateLimitedError', 'RATE_LIMITED', unsafe,
            { service: 'explorer', retryAfterSeconds: 12 })],
        ['explorer refusal', codedError('SDKExplorerError', 'EXPLORER_HTTP_400', unsafe)],
        ['explorer outage', codedError('SDKExplorerError', 'EXPLORER_HTTP_502', unsafe)],
        ['explorer timeout', codedError('SDKExplorerError', 'EXPLORER_TIMEOUT', unsafe)],
        ['explorer network', codedError('SDKExplorerError', 'EXPLORER_NETWORK', unsafe)],
        ['stale chain data', codedError('SDKExplorerError', 'COIN_DATA_STALE', unsafe)],
        ['invalid network', codedError('SDKExplorerError', 'INVALID_NETWORK', unsafe)],
        ['invalid addresses', codedError('SDKExplorerError', 'INVALID_ADDRESSES', unsafe)],
        ['unsupported batch', codedError('SDKExplorerError', 'EXPLORER_BATCH_UNSUPPORTED', unsafe)],
        ...['WS_CONNECTION_CLOSED', 'WS_CONNECTION_FAILED', 'WS_TIMEOUT']
            .map((code) => [`websocket ${code}`, codedError('SDKExplorerError', code, unsafe)]),
        ['unknown explorer response', codedError('SDKExplorerError', 'EXPLORER_UNKNOWN', unsafe)],
    ];

    it.each(cases)('maps %s to short, safe, actionable copy', (_label, err, opts = {}) => {
        const message = submitFailureMessage(err, opts);
        const sentences = message.split(/(?<=[.!?])\s+/);

        expect(sentences.length).toBeGreaterThanOrEqual(1);
        expect(sentences.length).toBeLessThanOrEqual(2);
        expect(message).toMatch(/^[A-Z]/);
        expect(message).toMatch(/\.$/);
        expect(message).toMatch(NEXT_STEP);
        expect(message).not.toMatch(CODE_IDENTIFIER);
        expect(message).not.toMatch(STACK_OR_URL);
        expect(message).not.toContain(err.name);
        if (err.code) expect(message).not.toContain(err.code);
    });

    it.each([
        new Error('mystery failure at /RBTC/api/private'),
        new Error('{"token":"secret"}'),
        new Error('boom\n    at privateFunction (/private/source.js:1:2)'),
        null,
    ])('uses generic copy for an unknown failure', (err) => {
        const message = submitFailureMessage(err);
        expect(message).toBe("Couldn't complete this. Something went wrong. Try again.");
        expect(message).not.toMatch(PRIVATE_TEXT);
    });

    it('does not trust a fallback that embeds the unknown raw error', () => {
        const err = new Error('request failed for /RBTC/api/private');
        expect(submitFailureMessage(err, { fallback: `Send failed. ${err.message}` }))
            .toBe("Couldn't complete this. Something went wrong. Try again.");
    });
});

describe('userFacingMessage wire filtering', () => {
    const cases = [
        codedError('SDKHubError', 'HUB_UNAVAILABLE', 'Failed for https://private.example'),
        codedError('Error', 'NON_FINITE_AMOUNT', 'quote returned NaN'),
        new Error('Explorer returned HTTP 500 for /RBTC/api/feequote'),
        new Error('Hub request failed for /api/v1/chain-registry'),
        new Error('{"token":"secret"}'),
        new Error('boom\n    at privateFunction (/private/source.js:1:2)'),
    ];

    it.each(cases)('replaces typed or structured developer output', (err) => {
        expect(isDeveloperMessage(err)).toBe(true);
        expect(userFacingMessage(err, 'Please try again.')).toBe('Please try again.');
    });
});
