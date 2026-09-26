import { test } from 'node:test';
import { expect } from 'vitest';
import { classifyQuote, readQuote } from './regtest.js';

const reply = (body, status = 200) => async () => ({ status, json: async () => body });
const sequence = (...steps) => {
    let i = 0;
    const fn = async () => { fn.calls = ++i; return steps[Math.min(i - 1, steps.length - 1)](); };
    fn.calls = 0;
    return fn;
};
const opts = (fetchImpl, timeoutMs = 2_000) => ({ action: 'ISSUE', timeoutMs, fetchImpl, pauseMs: 1 });

test('classifies every body shape', () => {
    expect(classifyQuote({ valid: true, status: 'valid' })).toBe('verdict');
    expect(classifyQuote({ valid: false, status: 'invalid: TICK (length)' })).toBe('verdict');
    expect(classifyQuote({ code: 'UPSTREAM_ERROR' }, 502)).toBe('retry');
    expect(classifyQuote(null, 503)).toBe('retry');
    expect(classifyQuote({ code: 'PRICE_LAPSED' })).toBe('unreadable');
    expect(classifyQuote({})).toBe('unreadable');
    expect(classifyQuote(null)).toBe('unreadable');
});

test('a refusal is returned at once, not retried', async () => {
    const f = sequence(reply({ valid: false, status: 'invalid: TICK (length)' }));
    const q = await readQuote('u', opts(f));
    expect(q.status).toBe('invalid: TICK (length)');
    expect(f.calls).toBe(1);
});

test('transients are re-asked until a verdict arrives', async () => {
    const f = sequence(
        reply({ code: 'UPSTREAM_ERROR' }, 502),
        async () => { throw new Error('reset'); },
        reply({ valid: true, status: 'valid' }),
    );
    const q = await readQuote('u', opts(f));
    expect(q.status).toBe('valid');
    expect(f.calls).toBe(3);
});

test('a statusless body is re-asked then returned as-is, never given a status', async () => {
    const f = sequence(reply({ code: 'PRICE_LAPSED' }));
    const q = await readQuote('u', opts(f));
    expect(q.status).toBeUndefined();
    expect(q.code).toBe('PRICE_LAPSED');
    expect(f.calls).toBe(3);
});

test('an unreadable body that recovers yields the verdict', async () => {
    const f = sequence(reply({ code: 'X' }), reply({ status: 'valid', valid: true }));
    expect((await readQuote('u', opts(f))).status).toBe('valid');
});

test('endless transients throw with the last body', async () => {
    const f = sequence(reply({ code: 'UPSTREAM_ERROR' }, 502));
    await expect(readQuote('u', opts(f, 50))).rejects.toThrow(/UPSTREAM_ERROR/);
});
