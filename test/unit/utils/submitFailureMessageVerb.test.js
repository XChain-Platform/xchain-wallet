import { describe, it, expect } from 'vitest';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

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
});
