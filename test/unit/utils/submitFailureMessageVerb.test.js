import { describe, it, expect } from 'vitest';
import { submitFailureMessage, submitFailureDetails } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

describe('submitFailureMessage verb', () => {
    const err = new Error('insufficient funds for this transaction');

    it('uses the caller verb in the generic opener', () => {
        const msg = submitFailureMessage(err, { verb: 'send this message', fallback: err.message });
        expect(msg).toContain('send this message');
        expect(msg).not.toContain('complete this');
    });

    it('defaults to the generic verb when none is given', () => {
        const msg = submitFailureMessage(err, { fallback: err.message });
        expect(msg).toContain('complete this');
    });

    it('keeps a flow function prefix out of the sentence and in the details', () => {
        const raw = 'createList: params.TYPE must be "1" (TICK), "2" (ADDRESS), or "3" (UNION)';
        const flowErr = new Error(raw);
        const msg = submitFailureMessage(flowErr, { fallback: flowErr.message });
        expect(msg).not.toContain('createList:');
        expect(submitFailureDetails(flowErr, msg)).toBe(raw);
    });
});
