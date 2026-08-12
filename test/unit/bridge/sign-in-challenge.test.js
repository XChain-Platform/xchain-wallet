// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: §43.6 SIWX challenge origin binding.
//
// appId is supplied by the requesting page, so it must never be the only
// app identity in the signed bytes: a look-alike site could pass a
// legitimate app's appId and obtain a signature byte-identical to one
// the real app would produce. The v2 challenge embeds the wallet-stamped
// page origin between appId and address, and validateSignInChallenge
// requires relying backends to verify it. These tests pin:
//
//   - formatSignInChallenge embeds origin (immediately after appId) and
//     parseSignInChallenge round-trips it.
//   - validateSignInChallenge rejects an origin mismatch even when appId
//     and nonce both match (the impersonation scenario).
//   - v1-shaped challenges (no origin field) no longer parse.
//   - the extension's bridge.signIn handler embeds the content-script-
//     stamped req.origin in the challenge it signs.

import { describe, it, expect } from 'vitest';
// Compile-time raw import (same pattern as the other source-scanning
// unit tests), with no fs/cwd fragility under the jsdom environment.
import handlersSource from '../../../packages/extension/src/bridge/handlers.js?raw';
import {
    SIGN_IN_CHALLENGE_PREFIX,
    SIGN_IN_CHALLENGE_SEPARATOR,
    SIGN_IN_CHALLENGE_VERSION,
    formatSignInChallenge,
    parseSignInChallenge,
    validateSignInChallenge,
} from '../../../packages/bridge-spec/src/index.ts';

const NOW = 1_700_000_000_000;

function makeParts(overrides = {}) {
    return {
        version: SIGN_IN_CHALLENGE_VERSION,
        appId: 'legit-dapp',
        origin: 'https://legit.example',
        address: 'bc1qexampleaddress0000000000000000000000',
        nonce: 'abc123',
        timestamp: NOW,
        expiresAt: NOW + 5 * 60 * 1000,
        ...overrides,
    };
}

describe('SIWX challenge origin binding (§43.6 v2)', () => {
    it('formatSignInChallenge embeds the wallet-stamped origin after appId', () => {
        const challenge = formatSignInChallenge(makeParts());
        const segments = challenge.split(SIGN_IN_CHALLENGE_SEPARATOR);
        expect(segments[0]).toBe(SIGN_IN_CHALLENGE_PREFIX);
        expect(segments[1]).toBe('legit-dapp');
        expect(segments[2]).toBe('https://legit.example');
        expect(segments).toHaveLength(7);
    });

    it('parseSignInChallenge round-trips the origin field', () => {
        const parts = makeParts();
        const reparsed = parseSignInChallenge(formatSignInChallenge(parts));
        expect(reparsed).toEqual(parts);
    });

    it('rejects v1-shaped challenges that lack the origin field', () => {
        const v1 = [
            'XChain Sign-In',
            'legit-dapp',
            'bc1qexampleaddress0000000000000000000000',
            'abc123',
            String(NOW),
            String(NOW + 60_000),
        ].join(SIGN_IN_CHALLENGE_SEPARATOR);
        expect(parseSignInChallenge(v1)).toBeNull();
    });

    it('formatSignInChallenge rejects an origin containing the separator', () => {
        expect(() =>
            formatSignInChallenge(
                makeParts({ origin: `https://a.example${SIGN_IN_CHALLENGE_SEPARATOR}x` }),
            ),
        ).toThrow(/reserved separator/);
    });

    it('validateSignInChallenge accepts a challenge whose origin matches', () => {
        const failure = validateSignInChallenge(makeParts(), {
            appId: 'legit-dapp',
            origin: 'https://legit.example',
            nonce: 'abc123',
            now: NOW + 1000,
        });
        expect(failure).toBeNull();
    });

    it('validateSignInChallenge rejects an origin mismatch even when appId and nonce match', () => {
        // Impersonation scenario: a look-alike site passes the legitimate
        // appId, but the wallet stamped the site's real origin.
        const failure = validateSignInChallenge(
            makeParts({ origin: 'https://evil.example' }),
            {
                appId: 'legit-dapp',
                origin: 'https://legit.example',
                nonce: 'abc123',
                now: NOW + 1000,
            },
        );
        expect(failure).toMatch(/origin mismatch/i);
    });

    it('bridge.signIn embeds the content-script-stamped req.origin in the signed challenge', () => {
        // The parts object handed to the shared formatter must carry req.origin
        // (wallet-stamped) immediately after req.appId (page-supplied); the
        // formatter fixes the field order from there.
        expect(handlersSource).toMatch(
            /appId:\s*req\.appId,\s*origin:\s*req\.origin,\s*address:\s*decision\.address,/,
        );
    });

    //. bridge.signIn used to re-implement the wire format inline with
    // an array join, which drifted off the contract in two directions at once:
    // no reserved-separator guard (a page-supplied appId could inject
    // pseudo-fields ahead of the wallet-stamped origin) and ISO-string
    // timestamps where the spec declares epoch milliseconds, which made every
    // challenge the wallet emitted unparseable by the spec's own parser. The
    // pin above was a source regex, so it locked the inline form in rather than
    // catching the drift. These three assert the guarded path instead.
    it('bridge.signIn builds the challenge with the shared formatter, not an inline join', () => {
        expect(handlersSource).toMatch(/challenge\s*=\s*formatSignInChallenge\(challengeParts\)/);
        expect(handlersSource).not.toMatch(/\]\.join\(' \| '\)/);
    });

    it('bridge.signIn rejects a separator-poisoned appId or nonce before prompting', () => {
        // The guard must sit above the approvals.signIn call: a request the
        // formatter will refuse must never reach the user as a prompt.
        const guardAt = handlersSource.indexOf('contains the reserved separator');
        const promptAt = handlersSource.indexOf('await approvals.signIn(');
        expect(guardAt).toBeGreaterThan(-1);
        expect(promptAt).toBeGreaterThan(-1);
        expect(guardAt).toBeLessThan(promptAt);
    });

    it('a challenge built the way bridge.signIn builds one parses back', () => {
        // The exact parts shape the handler assembles, with epoch-ms timestamps.
        // The old ISO form failed this: Number('2026-...Z') is NaN, so
        // parseSignInChallenge returned null for every real sign-in.
        const parts = makeParts({ timestamp: NOW, expiresAt: NOW + 5 * 60 * 1000 });
        const reparsed = parseSignInChallenge(formatSignInChallenge(parts));
        expect(reparsed).not.toBeNull();
        expect(reparsed.timestamp).toBe(NOW);

        const isoStyle = [
            SIGN_IN_CHALLENGE_PREFIX,
            parts.appId,
            parts.origin,
            parts.address,
            parts.nonce,
            new Date(parts.timestamp).toISOString(),
            new Date(parts.expiresAt).toISOString(),
        ].join(SIGN_IN_CHALLENGE_SEPARATOR);
        expect(parseSignInChallenge(isoStyle)).toBeNull();
    });

    it('formatSignInChallenge refuses a separator-poisoned appId', () => {
        expect(() => formatSignInChallenge(makeParts({ appId: 'legit | injected' })))
            .toThrow(/reserved separator/);
    });
});
