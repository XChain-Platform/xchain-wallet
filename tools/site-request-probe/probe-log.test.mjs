// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    matrixRow,
    parseProbeLog,
    summarizeRedirect,
    summarizeReturn,
} from './probe-log.mjs';

function event(type, pageId, details = {}) {
    return { type, pageId, session: 'session-1', ...details };
}

test('parseProbeLog accepts probe arrays and rejects other input', () => {
    const log = [event('page-loaded', 'page-1')];
    assert.deepEqual(parseProbeLog(JSON.stringify(log)), log);

    for (const input of [
        'not JSON',
        JSON.stringify({ type: 'page-loaded', pageId: 'page-1', session: 'session-1' }),
        JSON.stringify([{ pageId: 'page-1', session: 'session-1' }]),
        JSON.stringify([{ type: 'page-loaded', session: 'session-1' }]),
        JSON.stringify([{ type: 'page-loaded', pageId: 'page-1' }]),
    ]) {
        assert.equal(parseProbeLog(input), null);
    }
});

test('summarizeReturn reads an intact landing log without parsing its user agent', () => {
    const userAgent = 'Browser/123 (device; detail|kept)';
    const landing = [event('page-loaded', 'landing-1', {
        landingMode: true,
        hash: '#marker',
        referrer: 'https://site.example/request',
        openerPresent: true,
        userAgent,
    })];
    const origin = [event('page-loaded', 'origin-1')];

    assert.deepEqual(summarizeReturn({ origin, landing, marker: 'marker' }), {
        landed: true,
        fragment: 'intact',
        referrer: 'https://site.example/request',
        openerPresent: true,
        landingUserAgent: userAgent,
        closed: 'not-tried',
        broadcastToOrigin: false,
    });
});

test('summarizeReturn reads landing and close request broadcasts from the origin log', () => {
    const landingSnapshot = {
        type: 'page-ready',
        pageId: 'landing-1',
        session: 'session-1',
        href: 'https://probe.example/?landing=1#marker',
        hash: '#marker',
        referrer: null,
        openerPresent: false,
        userAgent: 'Landing Browser',
    };
    const origin = [
        event('page-loaded', 'origin-1'),
        event('broadcast-received', 'origin-1', { message: landingSnapshot }),
        event('broadcast-received', 'origin-1', {
            message: event('window-close-requested', 'landing-1', {
                href: 'https://probe.example/?landing=1#marker',
            }),
        }),
    ];

    assert.deepEqual(summarizeReturn({ origin, landing: null, marker: 'marker' }), {
        landed: true,
        fragment: 'intact',
        referrer: null,
        openerPresent: false,
        landingUserAgent: 'Landing Browser',
        closed: 'requested',
        broadcastToOrigin: true,
    });
});

test('summarizeReturn gives close failure precedence over a close request', () => {
    const landing = [
        event('page-loaded', 'landing-1', {
            landingMode: true,
            hash: '#marker',
            referrer: null,
            openerPresent: false,
            userAgent: 'Browser',
        }),
        event('window-close-requested', 'landing-1'),
        event('window-close-did-not-close', 'landing-1'),
    ];

    assert.equal(summarizeReturn({ origin: null, landing, marker: 'marker' }).closed, 'did-not-close');
});

test('summarizeReturn reports not-tried when no close was requested', () => {
    const landing = [event('page-loaded', 'landing-1', {
        landingMode: true,
        hash: '#marker',
        referrer: null,
        openerPresent: false,
        userAgent: 'Browser',
    })];

    assert.equal(summarizeReturn({ origin: null, landing, marker: 'marker' }).closed, 'not-tried');
});

test('summarizeReturn distinguishes missing and changed fragments', () => {
    for (const [hash, expected] of [[null, 'missing'], ['#other', 'changed']]) {
        const landing = [event('page-loaded', 'landing-1', {
            landingMode: true,
            hash,
            referrer: null,
            openerPresent: false,
            userAgent: 'Browser',
        })];
        assert.equal(
            summarizeReturn({ origin: null, landing, marker: 'marker' }).fragment,
            expected,
        );
    }
});

test('summarizeReturn distinguishes no origin messages from no origin log', () => {
    const landing = [event('page-loaded', 'landing-1', {
        landingMode: true,
        hash: '#marker',
        referrer: null,
        openerPresent: false,
        userAgent: 'Browser',
    })];

    assert.equal(
        summarizeReturn({ origin: [event('page-loaded', 'origin-1')], landing, marker: 'marker' })
            .broadcastToOrigin,
        false,
    );
    assert.equal(
        summarizeReturn({ origin: null, landing, marker: 'marker' }).broadcastToOrigin,
        null,
    );
});

test('summarizeReturn leaves every detail empty when no landing is found', () => {
    const origin = [
        event('page-loaded', 'origin-1'),
        event('broadcast-received', 'origin-1', {
            message: event('page-ready', 'origin-1', {
                href: 'https://probe.example/?landing=1#marker',
            }),
        }),
        event('broadcast-received', 'origin-1', {
            message: event('page-ready', 'other-1', {
                href: 'https://probe.example/?landing=0#marker',
            }),
        }),
    ];
    assert.deepEqual(summarizeReturn({ origin, landing: null, marker: 'marker' }), {
        landed: false,
        fragment: null,
        referrer: null,
        openerPresent: null,
        landingUserAgent: null,
        closed: null,
        broadcastToOrigin: null,
    });
});

test('summarizeRedirect reports intact and missing destination fragments', () => {
    const intact = [event('page-loaded', 'destination-1', {
        hash: '#marker',
        navigationType: 'navigate',
    })];
    const missing = [event('page-loaded', 'destination-2', {
        hash: null,
        navigationType: 'reload',
    })];

    assert.deepEqual(summarizeRedirect({ destination: intact, marker: 'marker' }), {
        arrived: true,
        fragment: 'intact',
        navigationType: 'navigate',
    });
    assert.deepEqual(summarizeRedirect({ destination: missing, marker: 'marker' }), {
        arrived: true,
        fragment: 'missing',
        navigationType: 'reload',
    });
    assert.deepEqual(summarizeRedirect({ destination: null, marker: 'marker' }), {
        arrived: false,
        fragment: null,
        navigationType: null,
    });
});

test('matrixRow escapes pipes and prints null as an empty cell', () => {
    assert.equal(
        matrixRow(['Browser | version', null, false]),
        '| Browser \\| version | (empty) | false |',
    );
});
