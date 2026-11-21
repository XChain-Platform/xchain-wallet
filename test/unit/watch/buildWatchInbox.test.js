// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('../../../packages/core/src/shared/alertInbox.js', () => ({
    getDefaultAlertInbox: () => ({ list: mocks.list }),
}));

import { buildWatchInbox } from '../../../packages/core/src/watch/buildWatchInbox.js';

const alert = (id, overrides = {}) => ({
    id: `notification:incoming-receipt:${id}`,
    title: `Receipt ${id}`,
    message: `Payment ${id} arrived.`,
    at: Number(id),
    read: false,
    ...overrides,
});

describe('buildWatchInbox', () => {
    beforeEach(() => mocks.list.mockReset());

    it('maps the default alert inbox through the watch kinds contract', async () => {
        mocks.list.mockResolvedValue([
            alert(2, {
                title: 'Message from 1devmock',
                message: 'Counterparty abcdefghijklmnopqrstuvwxyz.',
                read: true,
            }),
            alert(1, { id: 'notification:tx-confirmed:tx-1' }),
        ]);

        expect(await buildWatchInbox()).toEqual([
            {
                id: 'notification:incoming-receipt:2',
                family: 'incomingReceipts',
                kind: 'incoming-receipt',
                title: 'Message from an address',
                body: 'Counterparty an address.',
                at: 2,
                read: true,
            },
            {
                id: 'notification:tx-confirmed:tx-1',
                family: 'txConfirmations',
                kind: 'tx-confirmed',
                title: 'Receipt 1',
                body: 'Payment 1 arrived.',
                at: 1,
                read: false,
            },
        ]);
        expect(mocks.list).toHaveBeenCalledOnce();
    });

    it('returns the newest 20 supported alerts and skips unknown kinds', async () => {
        mocks.list.mockResolvedValue([
            alert('unknown', { id: 'notification:not-on-watch:unknown', at: 100 }),
            ...Array.from({ length: 22 }, (_, index) => alert(22 - index)),
        ]);

        const rows = await buildWatchInbox();

        expect(rows).toHaveLength(20);
        expect(rows.map((row) => row.at)).toEqual(Array.from({ length: 20 }, (_, index) => 22 - index));
        expect(rows.some((row) => row.kind === 'not-on-watch')).toBe(false);
    });

    it('cuts redacted display copy at contract limits without splitting code points', async () => {
        const prefix = 'T-'.repeat(29);
        mocks.list.mockResolvedValue([alert(1, {
            title: `${prefix}😀xy`,
            message: `${'word '.repeat(40)}tail`,
        })]);

        const [row] = await buildWatchInbox();

        expect([...row.title]).toHaveLength(60);
        expect(row.title).toBe(`${prefix}😀…`);
        expect([...row.body].length).toBeLessThanOrEqual(160);
        expect(row.body.endsWith('…')).toBe(true);
    });
});
