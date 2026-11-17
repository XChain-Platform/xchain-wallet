// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createOsNotifier } from '../../../packages/desktop/main/osNotification.js';

function fakeNotification({ supported = true, show = vi.fn() } = {}) {
    const shown = [];
    class FakeNotification {
        static isSupported() { return supported; }
        constructor(options) { this.options = options; }
        show() { show(); shown.push(this.options); }
    }
    return { FakeNotification, shown, show };
}

describe('desktop OS notifier', () => {
    it('reports true after showing the notification', async () => {
        const { FakeNotification, shown } = fakeNotification();
        const notify = createOsNotifier({ Notification: FakeNotification });
        expect(await notify({ title: 'Price alert', body: 'Bitcoin rose above $1.' })).toBe(true);
        expect(shown).toEqual([{ title: 'Price alert', body: 'Bitcoin rose above $1.' }]);
    });

    it.each([
        ['true', { notifications: { desktop: true } }, 1],
        ['false', { notifications: { desktop: false } }, 0],
        ['undefined', { notifications: {} }, 1],
    ])('desktop setting %s controls whether the OS notification shows', async (_label, settings, count) => {
        const { FakeNotification, shown } = fakeNotification();
        const notify = createOsNotifier({ Notification: FakeNotification, getSettings: async () => settings });
        expect(await notify({ title: 't', body: 'b' })).toBe(true);
        expect(shown).toHaveLength(count);
    });

    it('shows the notification when settings cannot be read (vault locked)', async () => {
        const { FakeNotification, shown } = fakeNotification();
        const notify = createOsNotifier({ Notification: FakeNotification, getSettings: () => { throw new Error('locked'); } });
        await notify({ title: 't', body: 'b' });
        expect(shown).toHaveLength(1);
    });

    it('reports false when the platform has no notifications', async () => {
        const { FakeNotification, shown } = fakeNotification({ supported: false });
        const notify = createOsNotifier({ Notification: FakeNotification });
        expect(await notify({ title: 't', body: 'b' })).toBe(false);
        expect(shown).toEqual([]);
    });

    it('reports false and the failure when showing throws', async () => {
        const error = new Error('denied');
        const { FakeNotification } = fakeNotification({ show: () => { throw error; } });
        const reportFailure = vi.fn();
        const notify = createOsNotifier({ Notification: FakeNotification, reportFailure });
        expect(await notify({ title: 't', body: 'b' })).toBe(false);
        expect(reportFailure).toHaveBeenCalledWith('desktop notification', error);
    });
});
