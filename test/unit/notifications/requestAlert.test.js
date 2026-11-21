// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { composeRequestAlert } from '../../../packages/core/src/notifications/requestAlert.js';

const ID = '0123456789abcdef0123456789abcdef';
const LABELS = { request: 'Request', paydue: 'Payment due' };
const NOW = 1_000;

function request(overrides = {}) {
    return {
        id: ID,
        kind: 'request',
        iconHash: 'icon-hash',
        sentence: 'Confirm this request',
        amountText: '1.25 XCH',
        ...overrides,
    };
}

describe('composeRequestAlert', () => {
    it('composes a confirm request with an amount', () => {
        expect(composeRequestAlert(request(), { labels: LABELS, now: () => NOW })).toEqual({
            kind: 'request',
            title: 'Request',
            body: 'Confirm this request\n1.25 XCH',
            data: { requestId: ID },
        });
    });

    it('composes a confirm request without an amount', () => {
        expect(composeRequestAlert(request({ amountText: '' }), {
            labels: LABELS,
            now: () => NOW,
        })).toEqual({
            kind: 'request',
            title: 'Request',
            body: 'Confirm this request',
            data: { requestId: ID },
        });
    });

    it('composes a pay-due request with a future expiry', () => {
        expect(composeRequestAlert(request({
            kind: 'paydue',
            sentence: 'Payment is due',
            expiresAt: 2_000,
        }), { labels: LABELS, now: () => NOW })).toEqual({
            kind: 'paydue',
            title: 'Payment due',
            body: 'Payment is due\n1.25 XCH',
            data: { requestId: ID, expiresAt: 2_000 },
        });
    });

    it('rejects a pay-due request with a past expiry', () => {
        expect(composeRequestAlert(request({ kind: 'paydue', expiresAt: 999 }), {
            labels: LABELS,
            now: () => NOW,
        })).toBeNull();
    });

    it('rejects an unknown kind', () => {
        expect(composeRequestAlert(request({ kind: 'unknown' }), {
            labels: LABELS,
            now: () => NOW,
        })).toBeNull();
    });

    it('rejects a short id', () => {
        expect(composeRequestAlert(request({ id: '0123456789abcdef' }), {
            labels: LABELS,
            now: () => NOW,
        })).toBeNull();
    });

    it('rejects an empty sentence', () => {
        expect(composeRequestAlert(request({ sentence: '' }), {
            labels: LABELS,
            now: () => NOW,
        })).toBeNull();
    });

    it('rejects a missing matching label', () => {
        expect(composeRequestAlert(request(), {
            labels: { paydue: 'Payment due' },
            now: () => NOW,
        })).toBeNull();
    });
});
