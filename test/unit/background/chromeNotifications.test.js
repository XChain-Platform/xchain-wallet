// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { createChromeNotifier } from '../../../packages/extension/src/background/chromeNotifications.js';

function harness(create = vi.fn(async () => 'notification-id')) {
    const chrome = {
        notifications: { create },
        runtime: { getURL: vi.fn((path) => `chrome-extension://wallet/${path}`) },
    };
    const logger = { error: vi.fn() };
    const notify = createChromeNotifier(chrome, { now: () => 1234, logger });
    return { chrome, create, logger, notify };
}

describe('extension Chrome notifications', () => {
    it('awaits delivery and gives same-tick notifications unique ids', async () => {
        const { chrome, create, notify } = harness();
        const first = await notify({ kind: 'incoming', title: 'Received', body: '1 BTC' });
        const second = await notify({ kind: 'incoming', title: 'Received', body: '2 BTC' });

        expect(first).toBe(true);
        expect(second).toBe(true);
        expect(create.mock.calls[0][0]).toBe('xchain-incoming-1234-0');
        expect(create.mock.calls[1][0]).toBe('xchain-incoming-1234-1');
        expect(create.mock.calls[0][1]).toEqual({
            type: 'basic',
            iconUrl: 'chrome-extension://wallet/icons/icon-128.png',
            title: 'Received',
            message: '1 BTC',
        });
        expect(chrome.runtime.getURL).toHaveBeenCalledWith('icons/icon-128.png');
    });

    it('reports rejected Chrome delivery without leaking the rejection', async () => {
        const error = new Error('permission denied');
        const { logger, notify } = harness(vi.fn(async () => { throw error; }));

        await expect(notify({ kind: 'incoming', title: 'Received', body: '1 BTC' }))
            .resolves.toBe(false);
        expect(logger.error).toHaveBeenCalledWith(
            '[xchain] chrome.notifications failed:',
            error,
        );
    });

    it('reports no visible delivery when Chrome notifications are unavailable', async () => {
        const notify = createChromeNotifier({ runtime: { getURL: vi.fn() } });

        await expect(notify({ kind: 'incoming', title: 'Received', body: '1 BTC' }))
            .resolves.toBe(false);
    });
});
