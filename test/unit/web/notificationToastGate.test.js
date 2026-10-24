// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    createNotificationToastGate,
    SUMMARY_TOAST_ID,
} from '../../../packages/web/src/notifications/notificationToastGate.js';

describe('notification toast gate', () => {
    it('passes the first three toasts of a burst through unchanged', () => {
        const gate = createNotificationToastGate({ now: () => 0 });
        expect(gate('a')).toEqual({ message: 'a' });
        expect(gate('b')).toEqual({ message: 'b' });
        expect(gate('c')).toEqual({ message: 'c' });
    });

    it('folds a 500 event burst into one summary toast id', () => {
        const gate = createNotificationToastGate({ now: () => 0 });
        const ids = new Set();
        let last;
        for (let i = 0; i < 500; i += 1) {
            last = gate(`event ${i}`);
            if (last.id) ids.add(last.id);
        }
        expect([...ids]).toEqual([SUMMARY_TOAST_ID]);
        expect(last.message).toBe('497 more notifications');
    });

    it('uses the singular for one folded toast', () => {
        const gate = createNotificationToastGate({ now: () => 0 });
        for (let i = 0; i < 3; i += 1) gate('x');
        expect(gate('y').message).toBe('1 more notification');
    });

    it('starts a fresh burst once the window has passed', () => {
        let at = 0;
        const gate = createNotificationToastGate({ now: () => at });
        for (let i = 0; i < 10; i += 1) gate('x');
        at = 9000;
        expect(gate('later')).toEqual({ message: 'later' });
    });
});
