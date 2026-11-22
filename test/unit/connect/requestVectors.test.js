// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const fixturePath = resolve('test/fixtures/connect/request-vectors.json');
const vectors = JSON.parse(readFileSync(fixturePath, 'utf8'));

const CLOSED_KEYS = new Set([
    'v',
    'id',
    'method',
    'params',
    'return',
    'callback',
    'state',
    'exp',
    'app',
    'browser',
]);
const METHODS = new Set(['login', 'signMessage', 'signAction', 'signPsbt']);
const BROWSERS = new Set(['chrome', 'firefox', 'edge', 'safari', 'samsung']);
const REQUIRED_RULES = [
    'unknown-key',
    'missing-v',
    'bad-v',
    'unknown-method',
    'no-target',
    'two-origins',
    'http-target',
    'target-credentials',
    'target-fragment',
    'target-too-long',
    'exp-past',
    'exp-over-10-min',
    'bad-browser',
    'bad-id',
];

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const targets = (envelope) => [envelope.return, envelope.callback]
    .filter((target) => typeof target === 'string');

const predicates = {
    'unknown-key': (envelope) => Object.keys(envelope).some((key) => !CLOSED_KEYS.has(key)),
    'missing-v': (envelope) => !hasOwn(envelope, 'v'),
    'bad-v': (envelope) => hasOwn(envelope, 'v') && envelope.v !== 1,
    'unknown-method': (envelope) => !METHODS.has(envelope.method),
    'no-target': (envelope) => targets(envelope).length === 0,
    'two-origins': (envelope) => Boolean(
        envelope.return
        && envelope.callback
        && new URL(envelope.return).origin !== new URL(envelope.callback).origin
    ),
    'http-target': (envelope) => targets(envelope)
        .some((target) => new URL(target).protocol === 'http:'),
    'target-credentials': (envelope) => targets(envelope)
        .some((target) => Boolean(new URL(target).username || new URL(target).password)),
    'target-fragment': (envelope) => targets(envelope)
        .some((target) => Boolean(new URL(target).hash)),
    'target-too-long': (envelope) => targets(envelope)
        .some((target) => target.length > 2_048),
    'exp-past': (envelope) => envelope.exp <= vectors.now,
    'exp-over-10-min': (envelope) => envelope.exp > vectors.now + 10 * 60 * 1_000,
    'bad-browser': (envelope) => hasOwn(envelope, 'browser')
        && !BROWSERS.has(envelope.browser),
    'bad-id': (envelope) => !/^[A-Za-z0-9_-]{22}$/.test(envelope.id),
};

describe('shared request envelope vectors', () => {
    it('contains every required invalid rule', () => {
        for (const rule of REQUIRED_RULES) {
            expect(vectors.invalid.some((entry) => entry.rule === rule), rule).toBe(true);
        }
    });

    it('keeps every valid envelope inside the closed schema', () => {
        expect(Number.isSafeInteger(vectors.now)).toBe(true);
        for (const { name, envelope } of vectors.valid) {
            expect(Object.keys(envelope).every((key) => CLOSED_KEYS.has(key)), name).toBe(true);
            expect(envelope.v, name).toBe(1);
            expect(targets(envelope).length, name).toBeGreaterThan(0);
            expect(envelope.id, name).toMatch(/^[A-Za-z0-9_-]{22}$/);
            expect(envelope.exp, name).toBeGreaterThan(vectors.now);
            expect(envelope.exp, name).toBeLessThanOrEqual(vectors.now + 10 * 60 * 1_000);
        }
    });

    it('makes each rejection predicate specific to invalid data', () => {
        for (const rule of REQUIRED_RULES) {
            const ruleVectors = vectors.invalid.filter((entry) => entry.rule === rule);
            for (const { name, envelope } of ruleVectors) {
                expect(predicates[rule](envelope), name).toBe(true);
            }
            for (const { name, envelope } of vectors.valid) {
                expect(predicates[rule](envelope), `${rule}: ${name}`).toBe(false);
            }
        }
    });

    it('pins the oversized target at exactly 2,049 characters', () => {
        const oversized = vectors.invalid.find((entry) => entry.rule === 'target-too-long');
        expect(targets(oversized.envelope).some((target) => target.length === 2_049)).toBe(true);
    });
});
