import { describe, expect, it } from 'vitest';
import { issueFeeFromSchedule } from '../../../packages/core/src/flows/issueFeeSchedule.js';

const schedule = {
    gasPrice: '0.00001',
    gasSchedule: { ISSUE: 100000, ISSUE_SUBTOKEN: 50000 },
    prices: { available: true, xchainUsd: '0.25', coinUsd: '98000' },
};

describe('issueFeeFromSchedule', () => {
    it('prices a top-level ticker, and a blank one, at the ISSUE gas', () => {
        expect(issueFeeFromSchedule(schedule, 'NEWTOKEN')).toEqual({
            xchainFee: '1.00000000', requiredFeeSats: 255, scheduleEstimate: true,
        });
        expect(issueFeeFromSchedule(schedule, '').xchainFee).toBe('1.00000000');
    });

    it('prices a dotted ticker at the ISSUE_SUBTOKEN gas', () => {
        expect(issueFeeFromSchedule(schedule, 'PARENT.CHILD')).toEqual({
            xchainFee: '0.50000000', requiredFeeSats: 128, scheduleEstimate: true,
        });
    });

    it('leaves the native figure out when the oracle prices are unavailable', () => {
        const quote = issueFeeFromSchedule({ ...schedule, prices: { available: false } }, 'A');
        expect(quote).toEqual({ xchainFee: '1.00000000', scheduleEstimate: true });
    });

    it('fails closed on anything that is not a priceable schedule', () => {
        expect(issueFeeFromSchedule(null, 'A')).toBeNull();
        expect(issueFeeFromSchedule([], 'A')).toBeNull();
        expect(issueFeeFromSchedule({ gasPrice: '0.00001', gasSchedule: {} }, 'A')).toBeNull();
        expect(issueFeeFromSchedule({ gasSchedule: { ISSUE: 100000 } }, 'A')).toBeNull();
    });
});
