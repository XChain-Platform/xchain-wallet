import { describe, it, expect } from 'vitest';
import { decodeAction } from '../../packages/core/src/decoder/actionDecoder.js';
import { defaultRegistry } from '../../packages/core/src/registry/index.js';

describe('decodeAction', () => {
    const chainRegistry = defaultRegistry();

    describe('SEND', () => {
        it('produces a human summary with chain name', () => {
            const d = decodeAction({
                action: 'SEND',
                params: {
                    TICK: 'MYTOKEN',
                    AMOUNT: '100',
                    DESTINATION: 'bc1qtest',
                },
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            expect(d.summary).toBe('Send 100 MYTOKEN on Bitcoin to bc1qtest');
        });

        it('omits the chain phrase when no registry is passed', () => {
            const d = decodeAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'bc1qx' },
            });
            expect(d.summary).toBe('Send 1 BTC to bc1qx');
        });

        it('places the memo in the details list only when non-empty', () => {
            const withMemo = decodeAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'x', MEMO: 'hi' },
            });
            expect(withMemo.details.find((r) => r.label === 'Memo'))
                .toEqual({ label: 'Memo', value: 'hi' });

            const withoutMemo = decodeAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'x' },
            });
            expect(withoutMemo.details.find((r) => r.label === 'Memo')).toBeUndefined();
        });

        it.each([
            ['hi|there', /\|/],
            ['hi;there', /\|/], // both chars share the same warning pattern
        ])('warns when memo contains a forbidden char (%s)', (memo, _pattern) => {
            const d = decodeAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'x', MEMO: memo },
            });
            expect(d.warnings.some((w) => /memo contains/i.test(w))).toBe(true);
        });

        it('warns on non-positive amount + empty destination', () => {
            const d = decodeAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '0', DESTINATION: '' },
            });
            expect(d.warnings.some((w) => /positive/i.test(w))).toBe(true);
            expect(d.warnings.some((w) => /destination is empty/i.test(w))).toBe(true);
        });
    });

    describe('SWEEP', () => {
        it('summarises the sweep destination and attaches the blanket warning', () => {
            const d = decodeAction({
                action: 'SWEEP',
                params: { DESTINATION: 'bc1qrecip' },
                chainId: 'dogecoin-mainnet',
                chainRegistry,
            });
            expect(d.summary).toBe('Sweep all assets on Dogecoin to bc1qrecip');
            expect(d.warnings.some((w) => /sweep moves every balance/i.test(w))).toBe(true);
        });

        it('includes flags + memo rows when provided', () => {
            const d = decodeAction({
                action: 'SWEEP',
                params: { DESTINATION: 'x', FLAGS: '3', MEMO: 'cleanup' },
            });
            expect(d.details.map((r) => r.label)).toEqual(['Destination', 'Flags', 'Memo']);
        });
    });

    describe('fallback', () => {
        it('surfaces the "no plain-English" warning for unknown kinds', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: { ASSET: 'NEWCOIN' },
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            expect(d.summary).toMatch(/^Sign ISSUE on Bitcoin$/);
            expect(d.warnings[0]).toMatch(/no plain-english summary/i);
        });

        it('pretty-prints non-string param values', () => {
            const d = decodeAction({
                action: 'UNKNOWN',
                params: { FLAG: true, NESTED: { foo: 'bar' } },
            });
            const nested = d.details.find((r) => r.label === 'NESTED');
            expect(nested?.value).toBe('{"foo":"bar"}');
        });
    });

    describe('guards', () => {
        it('returns a well-formed result for missing action + params', () => {
            const d = decodeAction({});
            expect(typeof d.summary).toBe('string');
            expect(Array.isArray(d.details)).toBe(true);
            expect(Array.isArray(d.warnings)).toBe(true);
        });
    });
});
