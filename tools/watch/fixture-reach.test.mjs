// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { fixtureReachFailures, sourceLiterals } from './fixture-reach.mjs';

test('extracts Swift fixture literals', () => {
    const source = 'let data = WatchFixtureFiles.data("inbox-alerts", in: directory)';

    assert.deepEqual(sourceLiterals(source), ['inbox-alerts']);
    assert.deepEqual(fixtureReachFailures({
        fixtures: ['inbox-alerts'],
        sources: { Swift: source },
    }), []);
});

test('matches a Kotlin resource literal with its json suffix', () => {
    const source = 'getResource("expected/request.json")';

    assert.deepEqual(fixtureReachFailures({
        fixtures: ['expected/request'],
        sources: { Kotlin: source },
    }), []);
});

test('matches a flat fixture prefix without reaching nested fixtures', () => {
    assert.deepEqual(fixtureReachFailures({
        fixtures: ['snapshot-zebra', 'expected/balances', 'snapshot-alpha'],
        sources: { Swift: 'WatchFixtureFiles.names(prefix: "snapshot-", in: directory)' },
    }), ['Swift:unreached:expected/balances']);
});

test('ignores literals inside line and block comments', () => {
    const source = `
        // load("line-only")
        /* load("block-only") */
        load("reached")
    `;

    assert.deepEqual(sourceLiterals(source), ['reached']);
    assert.deepEqual(fixtureReachFailures({
        fixtures: ['line-only', 'block-only', 'reached'],
        sources: { Java: source },
    }), [
        'Java:unreached:block-only',
        'Java:unreached:line-only',
    ]);
});

test('keeps an escaped quote inside its literal', () => {
    const source = String.raw`value("before \"quoted\" after"); value("next")`;

    assert.deepEqual(sourceLiterals(source), [
        String.raw`before \"quoted\" after`,
        'next',
    ]);
});

test('extracts a multiline double-quoted literal as one value', () => {
    const source = 'value("""first\nsecond"""); value("after")';

    assert.deepEqual(sourceLiterals(source), ['first\nsecond', 'after']);
});

test('reports platforms in key order and fixtures in sorted order', () => {
    assert.deepEqual(fixtureReachFailures({
        fixtures: ['zebra', 'alpha'],
        sources: {
            Wear: 'load("none")',
            Watch: 'load("none")',
        },
    }), [
        'Wear:unreached:alpha',
        'Wear:unreached:zebra',
        'Watch:unreached:alpha',
        'Watch:unreached:zebra',
    ]);
});

test('rejects missing fixtures', () => {
    assert.throws(() => fixtureReachFailures({ sources: { Swift: '' } }), TypeError);
});

test('rejects empty fixtures', () => {
    assert.throws(() => fixtureReachFailures({ fixtures: [], sources: { Swift: '' } }), TypeError);
});

test('rejects non-array fixtures', () => {
    assert.throws(() => fixtureReachFailures({
        fixtures: 'fixture',
        sources: { Swift: '' },
    }), TypeError);
});

test('rejects blank fixture names', () => {
    assert.throws(() => fixtureReachFailures({
        fixtures: ['   '],
        sources: { Swift: '' },
    }), TypeError);
});

test('rejects missing sources', () => {
    assert.throws(() => fixtureReachFailures({ fixtures: ['fixture'] }), TypeError);
});

test('rejects empty sources', () => {
    assert.throws(() => fixtureReachFailures({ fixtures: ['fixture'], sources: {} }), TypeError);
});

test('rejects non-string sources', () => {
    assert.throws(() => fixtureReachFailures({
        fixtures: ['fixture'],
        sources: { Swift: null },
    }), TypeError);
});
