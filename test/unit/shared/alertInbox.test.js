// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createAlertInbox } from '../../../packages/core/src/shared/alertInbox.js';

function memoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
}

const alert = (id, at = 1) => ({ id, type: 'activity', title: `Title ${id}`, message: `Message ${id}`, at, read: false });

describe('alertInbox', () => {
    it('records, deduplicates by id, and keeps only the newest capped rows', async () => {
        const inbox = createAlertInbox(memoryStorage(), { limit: 2 });
        await inbox.record(alert('one', 1));
        await inbox.record(alert('two', 2));
        await inbox.record(alert('one', 3));
        await inbox.record(alert('three', 4));

        expect((await inbox.list()).map((row) => row.id)).toEqual(['three', 'one']);
        expect((await inbox.list()).filter((row) => row.id === 'one')).toHaveLength(1);
    });

    it('marks one or every row read and reports the unread count', async () => {
        const inbox = createAlertInbox(memoryStorage());
        await inbox.record(alert('one'));
        await inbox.record(alert('two', 2));
        expect(await inbox.unreadCount()).toBe(2);
        await inbox.markRead('one');
        expect(await inbox.unreadCount()).toBe(1);
        await inbox.markAllRead();
        expect(await inbox.unreadCount()).toBe(0);
    });

    it('round trips persisted rows through a fresh inbox instance', async () => {
        const storage = memoryStorage();
        const first = createAlertInbox(storage);
        await first.record(alert('saved', 10));
        await first.markRead('saved');

        expect(await createAlertInbox(storage).list()).toEqual([{ ...alert('saved', 10), read: true }]);
    });
});
