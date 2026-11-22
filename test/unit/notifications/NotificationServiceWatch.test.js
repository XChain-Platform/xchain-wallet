// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../../packages/core/src/notifications/NotificationService.js';

const REQUEST_ID = '0123456789abcdef0123456789abcdef';

function makeAdapter() {
    let actionHandler;
    const notify = vi.fn(async () => true);
    notify.cancel = vi.fn(async () => true);
    notify.onAction = vi.fn((handler) => {
        actionHandler = handler;
        return vi.fn(() => { actionHandler = undefined; });
    });
    notify.emitAction = (event) => actionHandler?.(event);
    return notify;
}

function makeService(notify, now = () => Date.now()) {
    return new NotificationService({
        getActiveAddresses: async () => [],
        getSdkForChain: () => null,
        getSettings: async () => ({}),
        notify,
        recordAlert: async () => {},
        now,
    });
}

function request(overrides = {}) {
    return {
        id: REQUEST_ID,
        kind: 'request',
        sentence: 'Confirm this request',
        amountText: '1.25 XCH',
        ...overrides,
    };
}

describe('NotificationService request alerts', () => {
    afterEach(() => vi.useRealTimers());

    it('posts N2 and routes its one Open on phone action until the confirm closes', async () => {
        const notify = makeAdapter();
        const route = vi.fn();
        const service = makeService(notify, () => 1_000);
        await service.start();

        await service.postRequestAlert(request(), {
            labels: { request: 'Request', paydue: 'Payment due' },
            openOnPhoneTitle: 'Open on phone',
            route,
        });
        expect(notify).toHaveBeenCalledWith({
            id: REQUEST_ID,
            kind: 'request',
            title: 'Request',
            body: 'Confirm this request\n1.25 XCH',
            category: 'request',
            actions: [{ id: 'openOnPhone', title: 'Open on phone' }],
            data: { requestId: REQUEST_ID },
        });
        expect(notify.onAction).toHaveBeenCalledOnce();

        notify.emitAction({ id: REQUEST_ID, action: 'dismiss' });
        notify.emitAction({ id: 'fedcba9876543210fedcba9876543210', action: 'openOnPhone' });
        expect(route).not.toHaveBeenCalled();

        notify.emitAction({ id: REQUEST_ID, action: 'openOnPhone' });
        expect(route).toHaveBeenCalledOnce();

        expect(service.withdrawRequestAlert(REQUEST_ID)).toBe(true);
        expect(notify.cancel).toHaveBeenCalledWith(REQUEST_ID);
        notify.emitAction({ id: REQUEST_ID, action: 'openOnPhone' });
        expect(route).toHaveBeenCalledOnce();

        const unsubscribe = notify.onAction.mock.results[0].value;
        service.stop();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('includes pay-due expiry data and withdraws the card at its deadline', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const notify = makeAdapter();
        const service = makeService(notify);
        await service.start();

        await service.postRequestAlert(request({ kind: 'paydue', expiresAt: 2_000 }), {
            labels: { request: 'Request', paydue: 'Payment due' },
            openOnPhoneTitle: 'Open on phone',
            route: vi.fn(),
        });
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
            category: 'paydue',
            data: { requestId: REQUEST_ID, expiresAt: 2_000 },
        }));

        await vi.advanceTimersByTimeAsync(999);
        expect(notify.cancel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(notify.cancel).toHaveBeenCalledWith(REQUEST_ID);
        service.stop();
    });
});
