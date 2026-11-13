// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The agent account page lists the co-sign requests parked in the broker and
// sends Approve to the request's own approval window; listing and focusing
// never resolve a request.

import { describe, expect, it, vi } from 'vitest';
import { ApprovalBroker } from '../../../packages/extension/src/background/approvalBroker.js';

function harness() {
    let nextWindowId = 1;
    const windows = {
        create: vi.fn(async () => ({ id: nextWindowId++ })),
        remove: vi.fn(async () => {}),
        update: vi.fn(async () => ({})),
        onRemoved: { addListener: () => {} },
    };
    let nextRequestId = 1;
    const broker = new ApprovalBroker({
        action: { setBadgeText: vi.fn(async () => {}) },
        windows,
        newId: () => `request-${nextRequestId++}`,
        getUrl: (path) => path,
        setTimer: () => 0,
        clearTimer: () => {},
    });
    return { broker, windows };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ApprovalBroker.listPending and focus', () => {
    it('lists only the asked kind, oldest first, without resolving anything', async () => {
        const { broker } = harness();
        broker.coSign({ origin: 'https://agent.example', payload: { accountId: 'acct-1', psbtHex: 'aa' } });
        broker.signAction({ origin: 'https://site.example', payload: {} });
        broker.coSign({ origin: 'https://agent.example', payload: { accountId: 'acct-2', psbtHex: 'bb' } });
        await settle();

        const listed = broker.listPending('coSign');
        expect(listed.map((entry) => entry.id)).toEqual(['request-1', 'request-3']);
        expect(listed[0]).toEqual({
            id: 'request-1',
            kind: 'coSign',
            payload: { origin: 'https://agent.example', payload: { accountId: 'acct-1', psbtHex: 'aa' } },
        });
        expect(broker._pendingSize()).toBe(3);
    });

    it('focuses the request window and reports an unknown id as not focused', async () => {
        const { broker, windows } = harness();
        broker.coSign({ origin: 'https://agent.example', payload: { accountId: 'acct-1' } });
        await settle();

        await expect(broker.focus('request-1')).resolves.toBe(true);
        expect(windows.update).toHaveBeenCalledWith(1, { focused: true });
        await expect(broker.focus('request-9')).resolves.toBe(false);
        expect(broker._pendingSize()).toBe(1);
    });
});
