// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    classifyReturn,
    cleanReturnHref,
} from '../../../packages/connect/src/returnIntake.js';

const pending = {
    id: 'request-1',
    method: 'signMessage',
    nonce: 'nonce-1',
    state: 'state-1',
};

const fullEnvelope = {
    v: 1,
    id: pending.id,
    method: pending.method,
    ok: true,
    result: { signature: 'signature-1' },
    state: pending.state,
    claim: 'claim-1',
};

const refused = {
    kind: 'refused',
    error: {
        ok: false,
        error: 'NO_PENDING_REQUEST',
    },
};

describe('classifyReturn', () => {
    it('accepts a full payload matching the pending request', () => {
        expect(classifyReturn(fullEnvelope, pending)).toEqual({
            kind: 'solicited',
            envelope: fullEnvelope,
        });
    });

    it('accepts a short payload matching the pending request id', () => {
        const envelope = {
            id: pending.id,
            ok: true,
            claim: 'claim-1',
        };

        expect(classifyReturn(envelope, pending)).toEqual({
            kind: 'solicited',
            envelope,
        });
    });

    it.each([
        ['id', { ...fullEnvelope, id: 'request-2' }],
        ['method', { ...fullEnvelope, method: 'login' }],
        ['state', { ...fullEnvelope, state: 'state-2' }],
    ])('refuses a full payload with a mismatched %s', (_field, envelope) => {
        expect(classifyReturn(envelope, pending)).toEqual(refused);
    });

    it('recognizes a successful unsolicited login with an address', () => {
        const envelope = {
            v: 1,
            id: 'request-2',
            method: 'login',
            ok: true,
            result: { address: 'bc1qexample' },
            state: 'state-2',
            claim: 'claim-2',
        };

        expect(classifyReturn(envelope, null)).toEqual({
            kind: 'unsolicited-login',
            envelope,
            solicited: false,
            address: 'bc1qexample',
        });
    });

    it('refuses an unsolicited non-login result', () => {
        expect(classifyReturn(fullEnvelope, null)).toEqual(refused);
    });

    it('refuses a failed unsolicited login', () => {
        const envelope = {
            ...fullEnvelope,
            method: 'login',
            ok: false,
            error: 'USER_REJECTED',
        };
        delete envelope.result;

        expect(classifyReturn(envelope, null)).toEqual(refused);
    });

    it('refuses an unsolicited short payload', () => {
        expect(classifyReturn({
            id: 'request-2',
            ok: true,
            claim: 'claim-2',
        }, null)).toEqual(refused);
    });

    it('refuses an unsolicited login result without an address', () => {
        expect(classifyReturn({
            ...fullEnvelope,
            method: 'login',
            result: {},
        }, null)).toEqual(refused);
    });

    it('refuses a login for a different pending request', () => {
        expect(classifyReturn({
            ...fullEnvelope,
            id: 'request-2',
            method: 'login',
            result: { address: 'bc1qexample' },
        }, pending)).toEqual(refused);
    });
});

describe('cleanReturnHref', () => {
    it.each([
        ['a URL without a fragment', 'https://site.example/path', 'https://site.example/path'],
        ['an XChain fragment', 'https://site.example/path#xchain=payload', 'https://site.example/path'],
        ['another fragment', 'https://site.example/path#section', 'https://site.example/path#section'],
        [
            'a query string before an XChain fragment',
            'https://site.example/path?next=wallet#xchain=payload',
            'https://site.example/path?next=wallet',
        ],
    ])('cleans %s', (_case, href, expected) => {
        expect(cleanReturnHref(href)).toBe(expected);
    });
});
