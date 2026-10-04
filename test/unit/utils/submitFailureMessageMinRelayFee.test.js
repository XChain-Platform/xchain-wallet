import { describe, expect, it } from 'vitest';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

const FEE_TOO_LOW_MESSAGE = 'The network rejected this transaction because its fee is too low.';

describe('submitFailureMessage commit fee rejection', () => {
    it.each([
        'min relay fee not met',
        'fee too low',
    ])('replaces wrapped "%s" wording with house-voice copy', (reason) => {
        const message = submitFailureMessage(
            new Error(`broadcast failed (commit): Encoder RPC error: ${reason}`),
            { fallback: 'Send failed.' },
        );

        expect(message).toBe(FEE_TOO_LOW_MESSAGE);
        expect(message).not.toContain('broadcast failed');
        expect(message).not.toContain('Encoder RPC error');
    });

    it('does not apply commit rejection copy to another broadcast phase', () => {
        const message = submitFailureMessage(
            new Error('broadcast failed (prepare): Encoder RPC error: fee too low'),
            { fallback: 'Send failed.' },
        );

        expect(message).not.toBe(FEE_TOO_LOW_MESSAGE);
        expect(message).toContain('could not be built');
    });
});
