import { describe, expect, it } from 'vitest';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import {
    isDeveloperMessage,
    userFacingMessage,
} from '../../../packages/core/src/shared/utils/userFacingMessage.js';

function codedError(name, code, message) {
    return Object.assign(new Error(message), { name, code });
}

const NEXT_STEP = /check|choose|report|reconnect|retry|review|try again|update|wait/i;
const PRIVATE_TEXT = /\/RBTC\/api|feequote|https:\/\/private|\n\s*at\s|\{"token"/i;

describe('submitFailureMessage SDK error map', () => {
    const cases = [
        ['hub unavailable', 'SDKHubError', 'HUB_UNAVAILABLE'],
        ['SDK configuration', 'SDKConfigError', 'HUB_NOT_CONFIGURED'],
        ['validation', 'SDKValidationError', 'BATCH_CONSTRAINT'],
        ['format', 'SDKFormatError', 'UNKNOWN_ACTION'],
        ['encoder', 'SDKEncoderError', 'ENCODER_RPC_ERROR'],
        ['contract', 'SDKContractError', 'CONTRACT_LINT_FAILED'],
        ['wallet', 'SDKWalletError', 'INVALID_PSBT'],
        ['authorization', 'SDKAuthError', 'INVALID_WIF'],
        ['messaging', 'SDKMessagingError', 'INVALID_MESSAGE'],
        ['action', 'SDKActionError', 'ACTION_REJECTED'],
        ['shared signature', 'SDKMuSigError', 'SIGN_FAILED'],
        ['protected file', 'SDKGatedFileError', 'INVALID_PAYLOAD'],
        ['compression', 'SDKCompressionError', 'INPUT_TOO_LARGE'],
        ['policy', 'SDKPolicyError', 'POLICY_DENIED'],
        ['service payment', 'SDKX402Error', 'X402_PAYMENT_NOT_FOUND'],
        ['preflight', 'SDKPreflightError', 'PREFLIGHT_FAIL'],
        ['rate limit', 'SDKRateLimitedError', 'RATE_LIMITED'],
        ['base SDK error', 'SDKError', 'SOMETHING_NEW'],
        ['oracle fee', 'OracleFeeUnpayableError', undefined],
        ['non-finite amount', 'NonFiniteAmountError', 'NON_FINITE_AMOUNT'],
        ['invalid satoshi amount', 'InvalidSatsAmountError', 'INVALID_SATS_AMOUNT'],
        ['unknown chain', 'UnknownChainError', undefined],
        ['refused reveal inputs', 'RevealInputsRefusedError', 'REVEAL_INPUTS_REFUSED'],
    ];

    it.each(cases)('maps %s errors to safe copy with a next step', (_label, name, code) => {
        const raw = 'request failed for /RBTC/api/feequote?token=secret';
        const message = submitFailureMessage(codedError(name, code, raw));
        expect(message).toMatch(NEXT_STEP);
        expect(message).not.toBe(raw);
        expect(message).not.toMatch(PRIVATE_TEXT);
    });

    const explorerCases = [
        ['INVALID_NETWORK', 'Unknown network: private-network. Valid: bitcoin'],
        ['INVALID_ADDRESSES', 'addresses must be a non-empty array of at most 100 address strings'],
        ['EXPLORER_BATCH_UNSUPPORTED', 'Explorer does not serve /RBTC/api/balances/batch'],
        ['COIN_DATA_STALE', 'Explorer data for RBTC is behind the chain at block 12'],
        ['WS_CONNECTION_CLOSED', 'WebSocket closed before WELCOME (code: 1006)'],
        ['WS_CONNECTION_FAILED', 'WebSocket connection failed: https://private.example/socket'],
        ['WS_TIMEOUT', 'No response for request id: 4'],
    ];

    it.each(explorerCases)('maps explorer code %s without wire data', (code, raw) => {
        const message = submitFailureMessage(codedError('SDKExplorerError', code, raw));
        expect(message).toMatch(NEXT_STEP);
        expect(message).not.toBe(raw);
        expect(message).not.toMatch(PRIVATE_TEXT);
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
