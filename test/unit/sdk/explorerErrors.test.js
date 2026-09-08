// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-125: an SDK EXPLORER failure must not reach a user as a request URL.
//
// OBSERVED LIVE, not inferred: "Explorer returned HTTP 502 for
// /RBTC/api/feequote?action=..." reached the user during a fee run (campaign
// session 28). Before explorerErrors.js the wallet handled none of these - a
// search for SDKExplorerError or for any string the SDK's explorer client
// mints returned zero hits across the whole tree.
//
// The properties that make this worth a mapper rather than a string swap:
//   1. every sentence says NOTHING WAS SPENT, which is always true here (an
//      explorer read happens before anything is built or signed) and is the
//      difference between "try again" and "did I just pay twice?";
//   2. the URL, the query string and the words "Explorer"/"HTTP" are gone;
//   3. a 5xx and a 4xx are told apart, because one is worth retrying;
//   4. errors that are NOT explorer failures are left alone, so this cannot
//      swallow the encoder, params or broadcast sentences that go first;
//   5. an EXPLORER_* code minted after this file was written still gets a safe
//      sentence rather than falling through to the wire wording.

import { describe, it, expect } from 'vitest';
import {
    explorerErrorCode,
    explorerErrorMessage,
    explorerReadFailure,
    isExplorerError,
    rateLimitRetryAfterSeconds,
    rateLimitedMessage,
} from '../../../packages/core/src/sdk/explorerErrors.js';
import { encoderErrorMessage } from '../../../packages/core/src/sdk/encoderErrors.js';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { humanizeError } from '../../../packages/core/src/shared/utils/humanizeError.js';

/**
 * The shape that crosses the messaging boundary: name and message only.
 *
 * MessageHost.serializeError drops `code`, so this is what a form's catch
 * actually receives, and mapping it is the case that matters.
 */
function boundaryError(message) {
    const err = new Error(message);
    err.name = 'SDKExplorerError';
    return err;
}

/** The shape an in-process caller sees: the SDK error with its code intact. */
function codedError(code, message) {
    const err = boundaryError(message);
    err.code = code;
    return err;
}

describe('explorerErrorCode', () => {
    it('reads the code off the error when it survived', () => {
        expect(explorerErrorCode(codedError('EXPLORER_HTTP_502', 'anything at all'))).toBe('EXPLORER_HTTP_502');
    });

    it('recovers each code from the message the SDK writes', () => {
        expect(explorerErrorCode(boundaryError(
            'Explorer returned HTTP 502 for /RBTC/api/feequote?action=ISSUE'))).toBe('EXPLORER_HTTP_502');
        expect(explorerErrorCode(boundaryError(
            'Explorer request timed out: /RBTC/api/balances/bcrt1qxyz'))).toBe('EXPLORER_TIMEOUT');
        expect(explorerErrorCode(boundaryError(
            'Explorer request failed: getaddrinfo ENOTFOUND explorer.example'))).toBe('EXPLORER_NETWORK');
        expect(explorerErrorCode(boundaryError(
            'Explorer returned a malformed native-fee quote (xchainFee): refusing to size the fee output')))
            .toBe('EXPLORER_BAD_FEEQUOTE');
    });

    it('does not claim the websocket or programming-error codes', () => {
        // Same SDKExplorerError class, different failures, and their sentences
        // would be different ones. Claiming them here would put "nothing was
        // spent" on an error that has nothing to do with a submit.
        expect(explorerErrorCode(codedError('WS_CONNECTION_FAILED', 'WebSocket connection failed: x'))).toBe(null);
        expect(explorerErrorCode(codedError('WS_TIMEOUT', 'No response for request id: 4'))).toBe(null);
        expect(explorerErrorCode(codedError('INVALID_NETWORK', 'Unknown network: nope. Valid: ...'))).toBe(null);
        expect(isExplorerError(codedError('WS_TIMEOUT', 'No response for request id: 4'))).toBe(false);
    });

    it('ignores errors that are not the explorer client at all', () => {
        expect(explorerErrorCode(new Error('boom'))).toBe(null);
        expect(explorerErrorCode(null)).toBe(null);
        expect(explorerErrorCode('a string')).toBe(null);
        // A raw axios error carries a `code` too; it must not be mistaken for
        // one the SDK minted.
        const axiosish = new Error('connect ECONNREFUSED');
        axiosish.code = 'ECONNREFUSED';
        expect(explorerErrorCode(axiosish)).toBe(null);
    });
});

describe('explorerErrorMessage', () => {
    it('translates the 502 that was seen live, URL and all', () => {
        const msg = explorerErrorMessage(boundaryError(
            'Explorer returned HTTP 502 for /RBTC/api/feequote?action=ISSUE&params=0%7CTICK'));
        expect(msg).toMatch(/temporarily unavailable \(error 502\)/);
        expect(msg, 'nothing-was-spent is the part a user needs').toMatch(/nothing was spent/i);
        expect(msg, 'the request URL is still on screen').not.toMatch(/\/RBTC\/api|feequote|params=/);
        expect(msg, 'wire vocabulary is still on screen').not.toMatch(/Explorer returned|HTTP \d{3} for/);
    });

    it('tells a refusal apart from a bad minute', () => {
        expect(explorerErrorMessage(boundaryError('Explorer returned HTTP 404 for /RBTC/api/x')))
            .toMatch(/refused this request \(error 404\)/);
        expect(explorerErrorMessage(boundaryError('Explorer returned HTTP 404 for /RBTC/api/x')))
            .not.toMatch(/try again in a moment/i);
        // 429 is a rate limit, not a refusal of the request's content, and not
        // an outage either: it has its own sentence, below.
        expect(explorerErrorMessage(boundaryError('Explorer returned HTTP 429 for /RBTC/api/x')))
            .not.toMatch(/temporarily unavailable/);
        expect(explorerErrorMessage(boundaryError('Explorer returned HTTP 503 for /RBTC/api/x')))
            .toMatch(/temporarily unavailable \(error 503\)/);
    });

    it('says whose problem a timeout and an unreachable service are', () => {
        const timeout = explorerErrorMessage(boundaryError(
            'Explorer request timed out: /RBTC/api/balances/bcrt1qxyz'));
        expect(timeout).toMatch(/did not answer in time/);
        expect(timeout).toMatch(/nothing was spent/i);
        expect(timeout, 'the address is still on screen').not.toMatch(/bcrt1qxyz/);

        const network = explorerErrorMessage(boundaryError(
            'Explorer request failed: getaddrinfo ENOTFOUND explorer.example'));
        expect(network).toMatch(/could not reach/i);
        expect(network).toMatch(/check your connection/i);
        expect(network, 'a resolver error is still on screen').not.toMatch(/ENOTFOUND|getaddrinfo/);
    });

    it('explains a malformed quote as a refusal to guess', () => {
        const msg = explorerErrorMessage(boundaryError(
            'Explorer returned a malformed native-fee quote (xchainFee): refusing to size the fee output'));
        expect(msg).toMatch(/protocol fee for this action could not be read/i);
        expect(msg, 'the wallet declining to guess is the reassuring part').toMatch(/will not guess/i);
        expect(msg).toMatch(/nothing was spent/i);
    });

    it('gives an unknown EXPLORER_ code a safe sentence rather than the wire text', () => {
        const msg = explorerErrorMessage(codedError('EXPLORER_SOMETHING_NEW', 'Explorer did a new thing'));
        expect(msg).toMatch(/nothing was spent/i);
        expect(msg).not.toMatch(/Explorer did a new thing/);
    });

    it('returns null for anything it does not own, so the caller keeps its copy', () => {
        expect(explorerErrorMessage(new Error('Encoder RPC error: insufficient funds'))).toBe(null);
        expect(explorerErrorMessage(undefined)).toBe(null);
    });
});

describe('submitFailureMessage routes explorer failures', () => {
    it('shows the sentence rather than the fallback or the wire text', () => {
        const msg = submitFailureMessage(
            boundaryError('Explorer returned HTTP 502 for /RBTC/api/feequote?action=ISSUE'),
            { coinTicker: 'BTC', fallback: 'Deploy failed.' },
        );
        expect(msg).toMatch(/temporarily unavailable \(error 502\)/);
        expect(msg).not.toBe('Deploy failed.');
        expect(msg).not.toMatch(/feequote/);
    });

    it('leaves the more specific classifiers ahead of it untouched', () => {
        // An encoder failure must still get the encoder sentence: the explorer
        // check runs last precisely so it cannot shadow one.
        const encoder = submitFailureMessage(
            Object.assign(new Error('Encoder returned HTTP 502 for /createtx'), { name: 'SDKEncoderError' }),
            { coinTicker: 'BTC', fallback: 'Deploy failed.' },
        );
        expect(encoder).toMatch(/transaction service is temporarily unavailable/i);
    });

    it('still falls through for errors nobody has a sentence for', () => {
        expect(submitFailureMessage(new Error('something else'), { fallback: 'Deploy failed.' }))
            .toBe('Deploy failed.');
    });
});

// The four call sites that are NOT submits: OracleForm's published-price list
// and LinkForm's three action previews. They read, they do not spend, so the
// submit copy would answer a question the user never asked.
describe('explorerReadFailure, and humanizeError through it', () => {
    it('keeps the house voice and drops the URL', () => {
        const { message } = humanizeError(
            boundaryError('Explorer returned HTTP 502 for /RBTC/api/action/1234'), 'load that action');
        expect(message).toMatch(/^Couldn't load that action\./);
        expect(message).toMatch(/temporarily unavailable \(error 502\)/);
        expect(message, 'the URL is still on screen').not.toMatch(/\/RBTC\/api|Explorer returned/);
    });

    it('does not tell a reader that nothing was signed or sent', () => {
        // They were looking at a preview. Reassuring them about a transaction
        // implies one they never started.
        const { message } = humanizeError(
            boundaryError('Explorer returned HTTP 502 for /RBTC/api/action/1234'), 'load that action');
        expect(message).not.toMatch(/signed|sent|spent/i);
    });

    it('stops blaming the user connection for a service-side timeout', () => {
        // The old keyword chain matched "timed out" and answered "The network
        // is unreachable. Check your connection", which sends someone to reset
        // a router over an explorer that was slow.
        const { message, cause } = humanizeError(
            boundaryError('Explorer request timed out: /RBTC/api/action/1234'), 'load that action');
        expect(message).toMatch(/did not answer in time/);
        expect(message).not.toMatch(/check your connection/i);
        expect(cause, 'a slow service is worth retrying, and callers key off this').toBe('backend_behind');
    });

    it('still says check your connection when the wallet genuinely cannot reach it', () => {
        const { message, cause } = humanizeError(
            boundaryError('Explorer request failed: getaddrinfo ENOTFOUND explorer.example'), 'load that action');
        expect(message).toMatch(/could not reach/i);
        expect(message).toMatch(/check your connection/i);
        expect(cause).toBe('network');
    });

    it('marks a refusal as not worth retrying', () => {
        const { message, cause } = humanizeError(
            boundaryError('Explorer returned HTTP 404 for /RBTC/api/action/1234'), 'load that action');
        expect(message).toMatch(/refused that request \(error 404\)/);
        expect(message).not.toMatch(/try again/i);
        expect(cause).toBe('unknown');
        // The `cause === 'unknown'` branch appends the raw message; an explorer
        // failure must return before it, or the wire wording comes back in
        // through the side door.
        expect(message, 'the raw message was appended after all').not.toMatch(/Explorer returned HTTP/);
    });

    it('keeps the raw message available for logs', () => {
        const raw = 'Explorer returned HTTP 502 for /RBTC/api/action/1234';
        expect(humanizeError(boundaryError(raw), 'load that action').raw).toBe(raw);
    });

    it('leaves every other error to the existing classifier', () => {
        expect(humanizeError(new Error('insufficient funds'), 'send').cause).toBe('insufficient_funds');
        expect(humanizeError(new Error('utxo-tracker is not synced'), 'send').cause).toBe('backend_behind');
        expect(explorerReadFailure(new Error('boom'), 'send')).toBe(null);
    });
});

// Rate limiting (rate-limits spec, M4). A 429 that reached the wallet is one
// the SDK already waited out and re-asked for, so the honest sentence is not
// "temporarily unavailable, try again in a moment" - which invites the retry
// that keeps the bucket empty - but the number of seconds the origin named.
//
// Two SDK vintages have to land on the same branch, because the wallet ships
// pinned to 0.15.1 for a while yet: the NEW SDKRateLimitedError with its
// seconds, and the OLD SDKExplorerError + EXPLORER_HTTP_429 with none.
describe('rate limiting', () => {
    /** The new class in-process: fields intact. */
    const rateLimited = (message, fields = {}) => Object.assign(
        new Error(message),
        { name: 'SDKRateLimitedError', code: 'RATE_LIMITED', status: 429, ...fields },
    );
    /** The same error after the messaging boundary: name and message only. */
    const crossedBoundary = (message) => Object.assign(
        new Error(message), { name: 'SDKRateLimitedError' },
    );
    const EXPLORER_429 = 'Explorer returned HTTP 429 for /RLTC/api/balances/x; retry after 3 seconds';

    describe('explorerErrorCode', () => {
        it('claims the new class in-process and across the boundary', () => {
            expect(explorerErrorCode(rateLimited(EXPLORER_429, {
                service: 'explorer', retryAfterSeconds: 3,
            }))).toBe('RATE_LIMITED');
            expect(explorerErrorCode(crossedBoundary(EXPLORER_429))).toBe('RATE_LIMITED');
        });

        it('recognises the wait from the message alone, with no name and no code', () => {
            // Belt and braces for a host that reserializes into a plain Error:
            // only the new class writes the "; retry after N seconds" suffix.
            expect(explorerErrorCode(new Error(EXPLORER_429))).toBe('RATE_LIMITED');
        });

        it('still maps the shipped 0.15.1 shape, which carries no seconds at all', () => {
            expect(explorerErrorCode(boundaryError('Explorer returned HTTP 429 for /RLTC/api/x')))
                .toBe('EXPLORER_HTTP_429');
            expect(explorerErrorCode(codedError('EXPLORER_HTTP_429', 'Explorer returned HTTP 429 for /x')))
                .toBe('EXPLORER_HTTP_429');
        });

        it('does not claim the ENCODER half of the same error class', () => {
            // One class, two services: the code and the name say neither, so
            // claiming by name alone would put the explorer's read copy on a
            // failed submit.
            const encoder = rateLimited(
                'Encoder returned HTTP 429 for method create_tx; retry after 12 seconds',
                { service: 'encoder', retryAfterSeconds: 12 },
            );
            expect(explorerErrorCode(encoder)).toBe(null);
            expect(explorerErrorMessage(encoder)).toBe(null);
        });
    });

    describe('rateLimitRetryAfterSeconds', () => {
        it('prefers the field, which is the only one the SDK guarantees', () => {
            expect(rateLimitRetryAfterSeconds(rateLimited(EXPLORER_429, { retryAfterSeconds: 30 })))
                .toBe(30);
        });

        it('recovers the number from the message when the field did not survive', () => {
            expect(rateLimitRetryAfterSeconds(crossedBoundary(EXPLORER_429))).toBe(3);
            expect(rateLimitRetryAfterSeconds(crossedBoundary(
                'Encoder returned HTTP 429 for method create_tx; retry after 45 seconds'))).toBe(45);
        });

        it('is null when nobody named a number', () => {
            expect(rateLimitRetryAfterSeconds(boundaryError('Explorer returned HTTP 429 for /x'))).toBe(null);
            expect(rateLimitRetryAfterSeconds(new Error('boom'))).toBe(null);
            expect(rateLimitRetryAfterSeconds(null)).toBe(null);
        });
    });

    describe('rateLimitedMessage', () => {
        it('is the sentence the spec pins, singular and plural', () => {
            expect(rateLimitedMessage(3))
                .toBe('The service asked the wallet to slow down for 3 seconds; retrying.');
            // The countdown reaches 1 on screen, so "1 seconds" would ship.
            expect(rateLimitedMessage(1))
                .toBe('The service asked the wallet to slow down for 1 second; retrying.');
        });

        it('says "a moment" rather than invent a number it was never given', () => {
            expect(rateLimitedMessage(null))
                .toBe('The service asked the wallet to slow down for a moment; retrying.');
            expect(rateLimitedMessage(0))
                .toBe('The service asked the wallet to slow down for a moment; retrying.');
        });

        it('names the service the caller is talking to', () => {
            expect(rateLimitedMessage(12, { subject: 'The transaction service' }))
                .toBe('The transaction service asked the wallet to slow down for 12 seconds; retrying.');
        });
    });

    describe('the submit copy', () => {
        it('says the wait, then that nothing was spent', () => {
            const msg = explorerErrorMessage(crossedBoundary(EXPLORER_429));
            expect(msg).toBe('The service asked the wallet to slow down for 3 seconds; retrying. '
                + 'Nothing was signed or sent, so nothing was spent.');
            expect(msg, 'the URL is still on screen').not.toMatch(/\/RLTC\/api|Explorer returned/);
        });

        it('gives the shipped SDK shape the same branch, minus the number', () => {
            expect(explorerErrorMessage(boundaryError('Explorer returned HTTP 429 for /RLTC/api/x')))
                .toBe('The service asked the wallet to slow down for a moment; retrying. '
                    + 'Nothing was signed or sent, so nothing was spent.');
        });

        it('says it in the encoder voice for a refused submit', () => {
            const encoder = crossedBoundary(
                'Encoder returned HTTP 429 for method create_tx; retry after 12 seconds');
            expect(encoderErrorMessage(encoder, {}))
                .toBe('The transaction service asked the wallet to slow down for 12 seconds; retrying. '
                    + 'Nothing was signed or sent, so nothing was spent.');
        });

        it('keeps mapping the old encoder 429 code the same way', () => {
            const old = Object.assign(
                new Error('Encoder returned HTTP 429 for method create_tx'),
                { name: 'SDKEncoderError', code: 'ENCODER_HTTP_429' },
            );
            expect(encoderErrorMessage(old, {}))
                .toBe('The transaction service asked the wallet to slow down for a moment; retrying. '
                    + 'Nothing was signed or sent, so nothing was spent.');
        });

        it('leaves the 5xx wording alone', () => {
            expect(explorerErrorMessage(boundaryError('Explorer returned HTTP 503 for /x')))
                .toMatch(/temporarily unavailable \(error 503\)/);
            expect(encoderErrorMessage(Object.assign(
                new Error('Encoder returned HTTP 503 for method create_tx'),
                { name: 'SDKEncoderError' },
            ), {})).toMatch(/transaction service is temporarily unavailable \(error 503\)/);
        });
    });

    describe('the read copy, which Home counts down', () => {
        it('carries the cause and the seconds through humanizeError', () => {
            const h = humanizeError(crossedBoundary(EXPLORER_429), 'load balances');
            expect(h.message)
                .toBe("Couldn't load balances. The service asked the wallet to slow down for 3 seconds; retrying.");
            expect(h.cause).toBe('rate_limited');
            expect(h.retryAfterSeconds, 'the countdown has nothing to count').toBe(3);
        });

        it('hands the reader a null rather than a made-up wait', () => {
            const h = humanizeError(boundaryError('Explorer returned HTTP 429 for /RLTC/api/x'), 'load balances');
            expect(h.message)
                .toBe("Couldn't load balances. The service asked the wallet to slow down for a moment; retrying.");
            expect(h.cause).toBe('rate_limited');
            expect(h.retryAfterSeconds).toBe(null);
        });

        it('does not tell a reader nothing was signed or sent', () => {
            expect(humanizeError(crossedBoundary(EXPLORER_429), 'load balances').message)
                .not.toMatch(/signed|sent|spent/i);
        });

        it('leaves every other read failure without a wait to count', () => {
            const h = humanizeError(boundaryError('Explorer returned HTTP 503 for /x'), 'load balances');
            expect(h.cause).toBe('backend_behind');
            expect(h.retryAfterSeconds).toBeUndefined();
        });
    });
});
