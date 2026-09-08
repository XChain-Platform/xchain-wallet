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
import { createWebNotifyAdapter, NOTIFICATION_EVENT, soundUrl } from '../../../packages/web/src/notifications/webNotifyAdapter.js';

/**
 * A recording Audio: the M4 sound path is a fact only if play() was asked
 * for the right file, and jsdom has no audio device to hear it.
 */
function stubAudio({ reject = false } = {}) {
    const plays = [];
    const ctor = vi.fn(function Audio(src) {
        this.src = src;
        this.play = () => {
            plays.push(src);
            return reject ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
        };
    });
    vi.stubGlobal('Audio', ctor);
    return plays;
}

const sound = { id: 'pluck', file: 'pluck.mp3' };

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

    // §6 M4.1: the sound rides the in-app path, never the OS one, and is
    // never the sole signal.
    it('plays the resolved sound while the tab is visible, from the sounds directory', () => {
        stubVisibility('visible');
        stubNotification('granted');
        const plays = stubAudio();
        const seen = [];
        const onEvent = (e) => seen.push(e.detail.kind);
        window.addEventListener(NOTIFICATION_EVENT, onEvent);
        createWebNotifyAdapter()({ ...payload, sound });
        window.removeEventListener(NOTIFICATION_EVENT, onEvent);
        expect(seen).toEqual(['incoming-pending']);
        expect(plays).toEqual([soundUrl('pluck.mp3')]);
        expect(plays[0]).toMatch(/\/sounds\/pluck\.mp3$/);
    });

    it('plays nothing while the tab is hidden: the OS notification carries its own sound', () => {
        stubVisibility('hidden');
        const ctor = stubNotification('granted');
        const plays = stubAudio();
        createWebNotifyAdapter()({ ...payload, sound });
        expect(ctor).toHaveBeenCalledTimes(1);
        expect(plays).toEqual([]);
    });

    it('plays nothing when core resolved no sound (master off, family muted, or a payload without the field)', () => {
        stubVisibility('visible');
        stubNotification('granted');
        const plays = stubAudio();
        const notify = createWebNotifyAdapter();
        notify({ ...payload, sound: null });
        notify(payload);
        expect(plays).toEqual([]);
    });

    it('a refused play (autoplay policy) leaves the toast standing and throws nothing', async () => {
        stubVisibility('visible');
        stubNotification('granted');
        const plays = stubAudio({ reject: true });
        const seen = [];
        const onEvent = (e) => seen.push(e.detail.kind);
        window.addEventListener(NOTIFICATION_EVENT, onEvent);
        expect(() => createWebNotifyAdapter()({ ...payload, sound })).not.toThrow();
        await Promise.resolve();
        window.removeEventListener(NOTIFICATION_EVENT, onEvent);
        expect(seen).toEqual(['incoming-pending']);
        expect(plays).toHaveLength(1);
    });

    it('survives a runtime without Audio at all', () => {
        stubVisibility('visible');
        stubNotification('granted');
        vi.stubGlobal('Audio', undefined);
        expect(() => createWebNotifyAdapter()({ ...payload, sound })).not.toThrow();
    });

    describe('playSound (the settings preview)', () => {
        it('plays a palette id by its file, with no toast', () => {
            const plays = stubAudio();
            const seen = [];
            const onEvent = (e) => seen.push(e.detail);
            window.addEventListener(NOTIFICATION_EVENT, onEvent);
            const notify = createWebNotifyAdapter();
            expect(notify.playSound('chime')).toBe(true);
            window.removeEventListener(NOTIFICATION_EVENT, onEvent);
            expect(plays).toEqual([soundUrl('chime.mp3')]);
            expect(seen).toEqual([]);
        });

        it('none and unknown ids are a no-op reported as false', () => {
            const plays = stubAudio();
            const notify = createWebNotifyAdapter();
            expect(notify.playSound('none')).toBe(false);
            expect(notify.playSound('kazoo')).toBe(false);
            expect(notify.playSound(undefined)).toBe(false);
            expect(plays).toEqual([]);
        });
    });

    it('raises no OS notification without permission, and does not throw', () => {
        stubVisibility('hidden');
        const ctor = stubNotification('default');
        expect(() => createWebNotifyAdapter()(payload)).not.toThrow();
        expect(ctor).not.toHaveBeenCalled();
    });
});
