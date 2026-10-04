import { describe, it, expect } from 'vitest';
import { buildDevMockActionString } from '../../../packages/web/src/devMockActionString.js';

describe('buildDevMockActionString', () => {
    it('serializes BROADCAST with every field', () => {
        const params = { VERSION: '2', MESSAGE: 'hello', FEE: '1.5', MEMO: 'm' };
        expect(buildDevMockActionString('BROADCAST', params)).toBe('BROADCAST|2|hello|1.5|m');
    });

    it('defaults the BROADCAST version to 0', () => {
        expect(buildDevMockActionString('BROADCAST', { MESSAGE: 'hi' })).toBe('BROADCAST|0|hi');
    });

    it('keeps the SEND shape and appends a memo', () => {
        const params = { TICK: 'XCP', AMOUNT: '1', DESTINATION: 'addr' };
        expect(buildDevMockActionString('SEND', params)).toBe('SEND|0|XCP|1|addr');
        expect(buildDevMockActionString('SEND', { ...params, MEMO: 'x' })).toBe('SEND|0|XCP|1|addr|x');
    });

    it('treats null params as empty', () => {
        expect(buildDevMockActionString('SEND', null)).toBe('SEND|0');
    });
});
