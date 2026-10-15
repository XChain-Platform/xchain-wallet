// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalBroker } from '../../../packages/extension/src/background/approvalBroker.js';

// Chrome's service worker throws "Illegal invocation" when setTimeout or
// clearTimeout run with a `this` other than the global object; Node does
// not, so these stand-ins reproduce Chrome's check.
function strictTimers() {
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    const set = function strictSetTimeout(fn, ms) {
        if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
        return realSet(fn, ms);
    };
    const clear = function strictClearTimeout(id) {
        if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
        return realClear(id);
    };
    return { set, clear, realSet, realClear };
}

describe('ApprovalBroker default timers', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('arms and clears its approval timeout without calling the timers as methods', async () => {
        const timers = strictTimers();
        vi.stubGlobal('setTimeout', timers.set);
        vi.stubGlobal('clearTimeout', timers.clear);
        vi.stubGlobal('chrome', {
            action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
            windows: {
                create: vi.fn(async () => ({ id: 7 })),
                remove: vi.fn(async () => {}),
                onRemoved: { addListener: vi.fn() },
            },
        });

        const broker = new ApprovalBroker({ newId: () => 'timer-request' });
        const pending = broker.signAction({ origin: 'https://one.test' });
        await broker.cancelAll();

        await expect(pending).resolves.toEqual({ approved: false });
    });
});
