// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    alertVersion,
    readAlertCenter,
    writeAlertCenter,
} from '../../../packages/core/src/shared/utils/alertCenterMemory.js';

describe('alertCenterMemory', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('versions an alert from the fields that change its displayed content', () => {
        const alert = { id: 'alert-1', title: 'Upgrade', message: 'Version 2', severity: 'high' };
        expect(alertVersion(alert)).toBe('["alert-1","Upgrade","Version 2"]');
    });

    it('stores read and cleared versions independently per wallet', () => {
        writeAlertCenter('wallet-1', {
            read: new Set(['alert-1:v1', 'alert-2:v1']),
            cleared: new Set(['alert-3:v1']),
        });
        writeAlertCenter('wallet-2', {
            read: new Set(['other:v1']),
            cleared: new Set(),
        });

        expect(readAlertCenter('wallet-1')).toEqual({
            read: new Set(['alert-1:v1', 'alert-2:v1']),
            cleared: new Set(['alert-3:v1']),
        });
        expect(readAlertCenter('wallet-2').read).toEqual(new Set(['other:v1']));
    });

    it('filters malformed members and defaults malformed fields to empty sets', () => {
        localStorage.setItem('xc:alertCenter:wallet-1', JSON.stringify({
            read: ['alert-1:v1', null, 4],
            cleared: 'alert-2:v1',
        }));

        expect(readAlertCenter('wallet-1')).toEqual({
            read: new Set(['alert-1:v1']),
            cleared: new Set(),
        });
    });

    it('returns empty state for a missing wallet id or corrupt storage', () => {
        localStorage.setItem('xc:alertCenter:wallet-1', '{bad json');
        expect(readAlertCenter('wallet-1')).toEqual({ read: new Set(), cleared: new Set() });
        expect(readAlertCenter('')).toEqual({ read: new Set(), cleared: new Set() });
    });

    it('ignores missing wallet ids and unavailable storage', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        writeAlertCenter('', { read: new Set(['alert-1:v1']), cleared: new Set() });
        expect(setItem).not.toHaveBeenCalled();

        const fail = () => { throw new Error('storage unavailable'); };
        setItem.mockImplementation(fail);
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail);

        expect(() => writeAlertCenter('wallet-1', {
            read: new Set(['alert-1:v1']),
            cleared: new Set(),
        })).not.toThrow();
        expect(readAlertCenter('wallet-1')).toEqual({ read: new Set(), cleared: new Set() });
    });
});
