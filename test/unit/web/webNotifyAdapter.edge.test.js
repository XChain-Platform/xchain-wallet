// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebNotifyAdapter } from '../../../packages/web/src/notifications/webNotifyAdapter.js';

const payload = {
    kind: 'incoming-pending',
    title: 'Incoming payment',
    body: 'Waiting for confirmation.',
};

function setVisibility(state) {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setVisibility('visible');
});

describe('web notification adapter API failures', () => {
    it('contains an in-app event dispatch failure', () => {
        setVisibility('visible');
        vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {
            throw new Error('document detached');
        });

        expect(() => createWebNotifyAdapter()(payload)).not.toThrow();
        expect(createWebNotifyAdapter()(payload)).toBe(false);
    });

    it('contains an OS notification constructor failure after permission changes', () => {
        setVisibility('hidden');
        const Notification = vi.fn(() => { throw new Error('permission revoked'); });
        Notification.permission = 'granted';
        vi.stubGlobal('Notification', Notification);

        expect(createWebNotifyAdapter()(payload)).toBe(false);
        expect(Notification).toHaveBeenCalledWith(payload.title, { body: payload.body });
    });

    it('contains synchronous Audio construction and playback failures', () => {
        setVisibility('visible');
        vi.stubGlobal('Audio', vi.fn(() => { throw new Error('audio device unavailable'); }));
        const notify = createWebNotifyAdapter();

        expect(notify.playSound('chime')).toBe(false);

        vi.stubGlobal('Audio', vi.fn(function Audio() {
            this.play = () => { throw new Error('decode failed'); };
        }));
        expect(notify.playSound('chime')).toBe(false);
    });
});
