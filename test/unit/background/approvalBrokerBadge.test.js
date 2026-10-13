// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import {
    ApprovalBroker,
    approvalBadgeText,
} from '../../../packages/extension/src/background/approvalBroker.js';

function harness() {
    let nextWindowId = 1;
    const removed = [];
    const action = { setBadgeText: vi.fn(async () => {}) };
    const windows = {
        create: vi.fn(async () => ({ id: nextWindowId++ })),
        remove: vi.fn(async () => {}),
        onRemoved: { addListener: (fn) => removed.push(fn) },
    };
    let nextRequestId = 1;
    const broker = new ApprovalBroker({
        action,
        windows,
        newId: () => `request-${nextRequestId++}`,
        getUrl: (path) => path,
    });
    const flushBadge = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    };
    return { action, broker, flushBadge, removed, windows };
}

describe('ApprovalBroker action badge', () => {
    it('shows the pending count and clears it after decisions and closes', async () => {
        const { action, broker, flushBadge, removed } = harness();
        const first = broker.connect({ origin: 'https://one.test' });
        const second = broker.signMessage({ origin: 'https://two.test' });
        await flushBadge();

        expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '2' });

        await broker.resolve('request-1', { approved: false });
        await flushBadge();
        expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });

        removed[0](2);
        await flushBadge();
        expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
        await expect(first).resolves.toEqual({ approved: false });
        await expect(second).resolves.toEqual({ approved: false });
    });

    it('clears the badge if creating the approval window fails', async () => {
        const action = { setBadgeText: vi.fn(async () => {}) };
        const broker = new ApprovalBroker({
            action,
            windows: { create: vi.fn(async () => { throw new Error('blocked'); }) },
            newId: () => 'failed-request',
        });

        await expect(broker.connect({ origin: 'https://one.test' })).rejects.toThrow('blocked');
        await Promise.resolve();
        await Promise.resolve();
        expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    });

    it('keeps badge text within the browser action limit', () => {
        expect(approvalBadgeText(0)).toBe('');
        expect(approvalBadgeText(12)).toBe('12');
        expect(approvalBadgeText(100)).toBe('99+');
    });
});
