import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    alertVersion,
    readAlertCenter,
    writeAlertCenter,
} from '../../../../packages/core/src/shared/utils/alertCenterMemory.js';

beforeEach(() => localStorage.clear());

afterEach(() => vi.restoreAllMocks());

describe('alert center memory edge behavior', () => {
    it('builds a version from every user-visible alert field', () => {
        expect(alertVersion({ id: 'upgrade', title: 'Update', message: 'Restart required' }))
            .toBe('["upgrade","Update","Restart required"]');
    });

    it('returns empty state without a wallet or stored record', () => {
        const getItem = vi.spyOn(Storage.prototype, 'getItem');

        expect(readAlertCenter('')).toEqual({ read: new Set(), cleared: new Set() });
        expect(readAlertCenter('wallet-1')).toEqual({ read: new Set(), cleared: new Set() });
        expect(getItem).toHaveBeenCalledTimes(1);
    });

    it('filters malformed persisted members without discarding valid keys', () => {
        localStorage.setItem('xc:alertCenter:wallet-1', JSON.stringify({
            read: ['a', 3, null, 'b'],
            cleared: 'not-an-array',
        }));

        expect(readAlertCenter('wallet-1')).toEqual({
            read: new Set(['a', 'b']),
            cleared: new Set(),
        });
    });

    it('falls back to empty state when storage contains invalid JSON or refuses reads', () => {
        localStorage.setItem('xc:alertCenter:wallet-1', '{');
        expect(readAlertCenter('wallet-1')).toEqual({ read: new Set(), cleared: new Set() });

        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        expect(readAlertCenter('wallet-2')).toEqual({ read: new Set(), cleared: new Set() });
    });

    it('persists both sets and ignores writes without a wallet', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        writeAlertCenter('', { read: new Set(['ignored']), cleared: new Set() });
        writeAlertCenter('wallet-1', {
            read: new Set(['read-1']),
            cleared: new Set(['cleared-1']),
        });

        expect(setItem).toHaveBeenCalledTimes(1);
        expect(JSON.parse(localStorage.getItem('xc:alertCenter:wallet-1'))).toEqual({
            read: ['read-1'],
            cleared: ['cleared-1'],
        });
    });

    it('tolerates storage refusal while writing', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });

        expect(() => writeAlertCenter('wallet-1', {
            read: new Set(['read-1']),
            cleared: new Set(),
        })).not.toThrow();
    });
});
