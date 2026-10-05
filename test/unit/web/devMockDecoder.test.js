import { describe, it, expect } from 'vitest';
import { createDevMockDecoder } from '../../../packages/web/src/devMockDecoder.js';

const stub = (hex) => (hex === 'good' ? { actionString: 'SEND|0|XCP|1|addr' } : { inputs: [], outputs: [] });

describe('createDevMockDecoder', () => {
    const decoder = createDevMockDecoder(stub);

    it.each(['decodeActionFromPsbt', 'decodeActionStringFromPsbt'])('%s returns ok with the action string', (method) => {
        expect(decoder[method]('good')).toEqual({ ok: true, actionString: 'SEND|0|XCP|1|addr' });
    });

    it.each(['decodeActionFromPsbt', 'decodeActionStringFromPsbt'])('%s reports decode-failed without an action string', (method) => {
        expect(decoder[method]('bad')).toEqual({ ok: false, reason: 'decode-failed' });
    });
});
