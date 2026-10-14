// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createWebNotifyAdapter,
    NOTIFICATION_EVENT,
    soundUrl,
} from '../../../packages/web/src/notifications/webNotifyAdapter.js';

const payload = {
    kind: 'incoming-receipt',
    title: 'Payment received',
    body: 'A payment arrived.',
};

function visibility(state) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    visibility('visible');
});

describe('web notify adapter error fallbacks', () => {
    it('reports no delivery when event dispatch throws on a visible tab', () => {
        visibility('visible');
        vi.spyOn(window, 'dispatchEvent').mockImplementation(() => { throw new Error('DOM detached'); });
        vi.stubGlobal('Notification', undefined);

        expect(createWebNotifyAdapter()(payload)).toBe(false);
    });

    it('keeps a visible toast delivered when audio construction throws', () => {
        visibility('visible');
        vi.stubGlobal('Audio', vi.fn(() => { throw new Error('audio unavailable'); }));
        const received = [];
        const listener = (event) => received.push(event.detail);
        window.addEventListener(NOTIFICATION_EVENT, listener);

        expect(createWebNotifyAdapter()({
            ...payload,
            sound: { id: 'chime', file: 'chime.mp3' },
        })).toBe(true);
        window.removeEventListener(NOTIFICATION_EVENT, listener);
        expect(received).toEqual([payload]);
    });

    it('reports failed preview playback when play throws synchronously', () => {
        vi.stubGlobal('Audio', vi.fn(function Audio() {
            this.play = () => { throw new Error('decode failed'); };
        }));

        expect(createWebNotifyAdapter().playSound('chime')).toBe(false);
    });

    it('accepts an Audio play implementation with no promise result', () => {
        const ctor = vi.fn(function Audio(src) {
            this.src = src;
            this.play = vi.fn(() => undefined);
        });
        vi.stubGlobal('Audio', ctor);

        expect(createWebNotifyAdapter().playSound('glass')).toBe(true);
        expect(ctor).toHaveBeenCalledWith(soundUrl('glass.mp3'));
    });

    it('reports no delivery when the hidden-tab Notification constructor throws', () => {
        visibility('hidden');
        const NotificationStub = vi.fn(() => { throw new Error('permission revoked'); });
        NotificationStub.permission = 'granted';
        vi.stubGlobal('Notification', NotificationStub);

        expect(createWebNotifyAdapter()(payload)).toBe(false);
        expect(NotificationStub).toHaveBeenCalledTimes(1);
    });

    it('survives a missing CustomEvent constructor without attempting an OS toast', () => {
        visibility('visible');
        vi.stubGlobal('CustomEvent', undefined);
        const NotificationStub = vi.fn();
        NotificationStub.permission = 'granted';
        vi.stubGlobal('Notification', NotificationStub);

        expect(createWebNotifyAdapter()(payload)).toBe(false);
        expect(NotificationStub).not.toHaveBeenCalled();
    });
});
