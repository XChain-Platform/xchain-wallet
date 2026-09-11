// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// explorerErrors: the wallet's translation of xchain-sdk EXPLORER failures
// into sentences a person can act on.
//
// The third wording class, and the last of the three services a submit talks
// to. a later change covered the encoder, D-118 covered the params builder, and the
// explorer had nothing at all: a search of the whole wallet for
// SDKExplorerError, or for any of the strings it mints, returned zero hits
// before this file. So every one of its failures reached the user as the
// message the SDK writes for a stack trace, complete with the request URL:
//
//   "Explorer returned HTTP 502 for /RBTC/api/feequote?action=ISSUE&params=..."
//   "Explorer request timed out: /RBTC/api/balances/bcrt1q..."
//   "Explorer returned a malformed native-fee quote (xchainFee): refusing to
//    size the fee output"
//
// The first of those was observed reaching a user during a live fee run
// (campaign session 28). It is the D-121 shape exactly: a SERVICE-side fault,
// worded so it reads as something the person did, and it is the worse half of
// that shape because the explorer is what every fee-bearing action must ask
// before it can be priced at all.
//
// TWO THINGS THE SENTENCES MUST SAY, and they are the reason this is not just
// a string swap:
//   1. NOTHING WAS SPENT. An explorer read happens before the encoder builds
//      anything, so a failure here is always pre-signature. Saying so is the
//      difference between "try again" and "did I just pay twice?".
//   2. WHOSE FAULT IT IS. A 502 or a timeout is ours to fix and theirs to wait
//      out; a wallet that blames the user for it teaches them to distrust
//      their own balance.
//
// `code` does NOT survive the messaging boundary (MessageHost.serializeError
// carries only `{ name, message }`), so every code is recoverable from the
// message text as well - the same trick encoderErrors.js and nativeFeePreflight
// use. See encoderErrors.js for the full note on why.

// A code recovered from the developer-facing message, for the boundary-crossed
// case where `err.code` is gone. Ordered most-specific first; EXPLORER_HTTP_*
// carries its status through the capture group.
const MESSAGE_TO_CODE = [
    [/Explorer returned a malformed native-fee quote/i, 'EXPLORER_BAD_FEEQUOTE'],
    [/Explorer returned HTTP (\d{3})/i, 'EXPLORER_HTTP_$1'],
    [/Explorer request timed out:/i, 'EXPLORER_TIMEOUT'],
    [/Explorer request failed:/i, 'EXPLORER_NETWORK'],
];

// A 429 the SDK could not ride out (rate-limits spec, M4). The SDK honours
// `Retry-After` once and only throws when the second answer is a 429 as well,
// so reaching here means the wait is worth telling the user about rather than
// hiding. Two shapes have to map to the same branch:
//
//   NEW  `SDKRateLimitedError`, code `RATE_LIMITED`, fields `service` /
//        `retryAfterSeconds`, message "Explorer returned HTTP 429 for <url>;
//        retry after N seconds" (the suffix is absent when the origin sent no
//        header);
//   OLD  `SDKExplorerError` + `EXPLORER_HTTP_429`, no suffix, which the pinned
//        SDK 0.15.1 still throws and will until the wallet repins.
//
// The class is ONE class for two services, so neither its name nor its code
// says WHICH service refused: only the `service` field (in-process) or the
// message prefix (across the messaging boundary, where the fields are gone)
// can. Hence both tests below rather than a name check alone.
const EXPLORER_429_RE = /Explorer returned HTTP 429\b/i;
const RETRY_AFTER_RE = /;\s*retry after (\d+) seconds?/i;

/**
 * The SDK explorer error code, however the error reached us.
 *
 * @param {unknown} err
 * @returns {string|null}   null when this is not a recognisable explorer error
 */
export function explorerErrorCode(err) {
    if (!err || typeof err !== 'object') return null;
    const e = /** @type {any} */ (err);
    const code = typeof e.code === 'string' ? e.code : '';
    const name = typeof e.name === 'string' ? e.name : '';
    const message = String(e.message || '');
    // Rate limiting first: its code and name are not EXPLORER_-prefixed, and
    // the message-recovered path below would otherwise flatten it to a plain
    // EXPLORER_HTTP_429 and lose the seconds. A boundary-crossed error with
    // neither field left is recognised by the "; retry after N seconds" suffix,
    // which only the new class writes.
    if (code === 'RATE_LIMITED' || name === 'SDKRateLimitedError') {
        if (e.service === 'explorer' || EXPLORER_429_RE.test(message)) return 'RATE_LIMITED';
    }
    if (EXPLORER_429_RE.test(message) && RETRY_AFTER_RE.test(message)) return 'RATE_LIMITED';
    // Only codes the SDK actually mints count. A raw axios error also carries a
    // `code` (ECONNABORTED, ENOTFOUND), and the SDK's own WS_* / INVALID_NETWORK
    // codes are deliberately NOT claimed here: they are not a failed read of a
    // submit's data and their sentences would be different ones.
    if (code.startsWith('EXPLORER_')) return code;
    for (const [pattern, mapped] of MESSAGE_TO_CODE) {
        const m = pattern.exec(message);
        if (m) return mapped.replace('$1', m[1] || '');
    }
    return null;
}

/**
 * True when this error came from the SDK explorer client.
 *
 * Deliberately does NOT trust `name` alone: SDKExplorerError is also what the
 * websocket client throws (WS_CONNECTION_FAILED, WS_TIMEOUT) and what an
 * unknown-network programming error is minted as, and neither is the read
 * failure this module has sentences for.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isExplorerError(err) {
    return explorerErrorCode(err) !== null;
}

/**
 * How long the origin asked the wallet to wait, in whole seconds.
 *
 * The field when it is still there (in-process), otherwise the number the SDK
 * wrote into the message, which is the only copy that survives the messaging
 * boundary. null when neither is present, which is what an origin that sent no
 * `Retry-After` looks like and also what the pinned SDK 0.15.1 always looks
 * like: the copy says "a moment" for it rather than inventing a number.
 *
 * @param {unknown} err
 * @returns {number|null}
 */
export function rateLimitRetryAfterSeconds(err) {
    if (!err || typeof err !== 'object') return null;
    const e = /** @type {any} */ (err);
    if (Number.isInteger(e.retryAfterSeconds) && e.retryAfterSeconds >= 0) return e.retryAfterSeconds;
    const m = RETRY_AFTER_RE.exec(String(e.message || ''));
    if (!m) return null;
    const seconds = Number.parseInt(m[1], 10);
    return Number.isFinite(seconds) ? seconds : null;
}

/**
 * The one place the rate-limit sentence is written.
 *
 * Home re-renders it once a second off a shrinking `secondsOrNull`, and the two
 * submit mappers say it once, so the wording has to live in a single function
 * or the countdown and the banner drift apart. "; retrying." is a promise the
 * wallet keeps: Home re-loads at zero, and the SDK already spent its honoured
 * retry before this error was thrown.
 *
 * @param {number|null} secondsOrNull  whole seconds left to wait, null when unknown
 * @param {{ subject?: string }} [opts]  the service as the sentence names it
 * @returns {string}
 */
export function rateLimitedMessage(secondsOrNull, { subject = 'The service' } = {}) {
    const seconds = Number.isInteger(secondsOrNull) && secondsOrNull > 0 ? secondsOrNull : null;
    const wait = seconds === null ? 'a moment' : `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
    return `${subject} asked the wallet to slow down for ${wait}; retrying.`;
}

/**
 * The sentence to show a user when an SDK explorer read failed.
 *
 * @param {unknown} err
 * @returns {string|null}   null when this is not an explorer error (caller keeps its own copy)
 */
export function explorerErrorMessage(err) {
    const code = explorerErrorCode(err);
    if (!code) return null;

    if (code === 'EXPLORER_TIMEOUT') {
        return 'The service that reads the chain did not answer in time, so the wallet could not check '
            + 'this action before sending it. Nothing was signed or sent, so nothing was spent. Try '
            + 'again in a moment.';
    }

    if (code === 'EXPLORER_NETWORK') {
        return 'The wallet could not reach the service that reads the chain. Nothing was signed or sent, '
            + 'so nothing was spent. Check your connection and try again.';
    }

    if (code === 'EXPLORER_BAD_FEEQUOTE') {
        // Not retryable in the way a 502 is - the service answered, and its
        // answer was unusable - but the wallet REFUSING to size a fee output
        // from it is the correct outcome, so the sentence says that plainly
        // rather than implying a fault the user can clear by trying harder.
        return 'The protocol fee for this action could not be read: the service answered with a price '
            + 'the wallet could not use, and it will not guess at a fee it would send on-chain. Nothing '
            + 'was signed or sent, so nothing was spent. Try again in a moment, and report it if it '
            + 'keeps happening.';
    }

    if (code === 'RATE_LIMITED' || code === 'EXPLORER_HTTP_429') {
        // A rate limit is not "temporarily unavailable": the service is up and
        // answering, it is the wallet's own request rate it is pushing back on,
        // and it named a time. Saying both is what turns "try again in a
        // moment" (which invites the retry that keeps the bucket full) into a
        // wait the user can sit through. The pre-signature reassurance stays,
        // and stays LAST, because an explorer read on a submit path happens
        // before anything is built or signed.
        return `${rateLimitedMessage(rateLimitRetryAfterSeconds(err))} Nothing was signed or sent, `
            + 'so nothing was spent.';
    }

    if (code.startsWith('EXPLORER_HTTP_')) {
        const status = code.slice('EXPLORER_HTTP_'.length);
        // Same split as the encoder mapper: a 5xx is the service having a bad
        // minute, a 4xx is a request it refused and retrying will not fix. 429
        // left this branch for the rate-limit copy above.
        const retryable = status.startsWith('5');
        return retryable
            ? `The service that reads the chain is temporarily unavailable (error ${status}). Nothing was `
              + 'signed or sent, so nothing was spent. Try again in a moment.'
            : `The service that reads the chain refused this request (error ${status}). Nothing was signed `
              + 'or sent, so nothing was spent. If it keeps happening, please report it.';
    }

    // An EXPLORER_* code minted after this mapper was written. Say the safe,
    // true thing rather than fall through to the wire wording, which is the
    // whole failure this module exists to end.
    return 'The service that reads the chain could not answer, so the wallet could not check this action '
        + 'before sending it. Nothing was signed or sent, so nothing was spent. Try again in a moment.';
}

/**
 * The same failure on a READ surface, where the submit copy would be wrong.
 *
 * MEASURED, which is why this exists as a second entry point rather than the
 * sentences above being reused: of the 13 `humanizeError` call sites, 9 pass
 * their result as `submitFailureMessage`'s fallback and are already covered by
 * the mapper above, and 4 are pure previews - OracleForm's published-price list
 * and LinkForm's three action previews. Telling someone that "nothing was
 * signed or sent" when they were only LOOKING at something answers a question
 * they did not ask and implies a transaction they never started.
 *
 * So a read failure keeps `humanizeError`'s house voice ("Couldn't <verb>.")
 * and says only what is true: which service is not answering, and whether
 * waiting will help.
 *
 * @param {unknown} err
 * @param {string} [verb]   the caller's verb, e.g. 'load that action'
 * @returns {{ message: string, cause: 'network'|'backend_behind'|'rate_limited'|'unknown',
 *            retryAfterSeconds?: number|null }|null}
 */
export function explorerReadFailure(err, verb = 'complete this') {
    const code = explorerErrorCode(err);
    if (!code) return null;
    const opener = `Couldn't ${verb}.`;

    if (code === 'EXPLORER_NETWORK') {
        return {
            message: `${opener} The wallet could not reach the service that reads the chain. Check your `
                + 'connection and try again.',
            cause: 'network',
        };
    }
    if (code === 'EXPLORER_TIMEOUT') {
        // Deliberately NOT 'network': the old classifier matched the words
        // "timed out" and told the user their own connection was unreachable,
        // which sends them to reset a router over a service-side timeout.
        return {
            message: `${opener} The service that reads the chain did not answer in time. Try again in a moment.`,
            cause: 'backend_behind',
        };
    }
    if (code === 'RATE_LIMITED' || code === 'EXPLORER_HTTP_429') {
        // The read surface is the one that can act on the number: Home counts
        // it down and re-loads at zero, which is the "; retrying" the sentence
        // promises. `cause` is its own key so a caller does not have to parse
        // prose to tell a wait from an outage.
        const retryAfterSeconds = rateLimitRetryAfterSeconds(err);
        return {
            message: `${opener} ${rateLimitedMessage(retryAfterSeconds)}`,
            cause: 'rate_limited',
            retryAfterSeconds,
        };
    }
    if (code.startsWith('EXPLORER_HTTP_')) {
        const status = code.slice('EXPLORER_HTTP_'.length);
        const retryable = status.startsWith('5');
        return retryable
            ? {
                message: `${opener} The service that reads the chain is temporarily unavailable `
                    + `(error ${status}). Try again in a moment.`,
                cause: 'backend_behind',
            }
            : {
                message: `${opener} The service that reads the chain refused that request (error ${status}).`,
                cause: 'unknown',
            };
    }
    return {
        message: `${opener} The service that reads the chain could not answer. Try again in a moment.`,
        cause: 'backend_behind',
    };
}
