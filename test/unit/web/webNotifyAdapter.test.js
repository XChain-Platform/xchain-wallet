// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment jsdom

// The web shell's notify adapter: the OS half of M3's acceptance test 1
// ("an OS notification when backgrounded with permission"). The in-app half
// is driven on a venue (incoming-pending.regtest.spec.js); this half cannot
// be, because Playwright cannot background a tab, so the adapter's own
// branch is exercised here with the visibility state and the permission
// stubbed both ways.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebNotifyAdapter, NOTIFICATION_EVENT } from '../../../packages/web/src/notifications/webNotifyAdapter.js';

function stubVisibility(state) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

function stubNotification(permission) {
    const ctor = vi.fn(function Notification(title, opts) { this.title = title; this.opts = opts; });
    ctor.permission = permission;
    vi.stubGlobal('Notification', ctor);
    return ctor;
}

const payload = { kind: 'incoming-pending', title: 'Incoming on Litecoin', body: 'A payment to your Litecoin address is pending, waiting for a block.' };

describe('webNotifyAdapter', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        stubVisibility('visible');
    });

    it('always dispatches the in-app event, carrying the kind', () => {
        const seen = [];
        const onEvent = (e) => seen.push(e.detail);
        window.addEventListener(NOTIFICATION_EVENT, onEvent);
        stubVisibility('visible');
        stubNotification('granted');
        createWebNotifyAdapter()(payload);
        window.removeEventListener(NOTIFICATION_EVENT, onEvent);
        expect(seen).toEqual([payload]);
    });

    it('raises an OS notification when the tab is hidden and permission is granted', () => {
        stubVisibility('hidden');
        const ctor = stubNotification('granted');
        createWebNotifyAdapter()(payload);
        expect(ctor).toHaveBeenCalledTimes(1);
        expect(ctor.mock.calls[0][0]).toBe(payload.title);
        expect(ctor.mock.calls[0][1]).toEqual({ body: payload.body });
    });

    it('raises no OS notification while the tab is visible (the toast covers it)', () => {
        stubVisibility('visible');
        const ctor = stubNotification('granted');
        createWebNotifyAdapter()(payload);
        expect(ctor).not.toHaveBeenCalled();
    });

    it('raises no OS notification without permission, and does not throw', () => {
        stubVisibility('hidden');
        const ctor = stubNotification('default');
        expect(() => createWebNotifyAdapter()(payload)).not.toThrow();
        expect(ctor).not.toHaveBeenCalled();
    });
});
