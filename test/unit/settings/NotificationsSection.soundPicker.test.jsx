// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Settings > Notifications > Notification Sounds > Choose Sound, end to end in
// the Settings route (operator 2026-11-15): each sound field is the standard
// picker field and opens the Choose Sound page; a row tap plays that sound
// once and saves it; Back returns to Notification Sounds with the field
// showing the pick. The player is the web shell's own: the host bridge wiring
// (hostBridge.js) hands SOUND_PREVIEW_EVENT to the web notify adapter's
// playSound, the code a delivered notification's sound plays through, with
// the browser Audio element mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { SOUND_NONE, SOUND_PREVIEW_EVENT } from '../../../packages/core/src/notifications/notificationSounds.js';
import { createWebNotifyAdapter } from '../../../packages/web/src/notifications/webNotifyAdapter.js';

let settings;
let played;
let playImpl;
let bridge;

function merge(base, patch) {
    const out = { ...base };
    for (const [key, value] of Object.entries(patch || {})) {
        out[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(base?.[key] || {}, value) : value;
    }
    return out;
}

function settingsMessaging() {
    const base = {
        supportsNotificationSoundPlayback: true,
        getSettings: vi.fn(async () => settings),
        updateSettings: vi.fn(async (patch) => { settings = merge(settings, patch); return settings; }),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(() => new Promise(() => {}));
            target[property] = stub;
            return stub;
        },
    });
}

let messaging;
function renderSettings(id) {
    messaging = settingsMessaging();
    return render(
        <MessagingContext.Provider value={{ shell: 'web', messaging }}>
            <Settings
                onBack={() => {}}
                activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
                activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
                onOpenWalletPicker={() => {}}
                onOpenAccountPicker={() => {}}
                initialSubpageId={id}
            />
        </MessagingContext.Provider>,
    );
}

const field = (label) => screen.findByRole('button', { name: new RegExp(`^${label} sound:`) });
const row = (value) => document.querySelector(`[data-settings-choice="${value}"] button`);
const ticked = () => [...document.querySelectorAll('[data-settings-choice]')]
    .filter((li) => li.querySelector('[data-settings-choice-check]'))
    .map((li) => li.getAttribute('data-settings-choice'));

const priorAudio = globalThis.Audio;

beforeEach(() => {
    settings = { ...createDefaultSettings(), activeNetwork: 'mainnet', sounds: { enabled: false, perKind: {} } };
    played = [];
    playImpl = () => Promise.resolve();
    // The browser's Audio element: records each file a play starts on.
    globalThis.Audio = class {
        constructor(src) { this.src = src; }
        play() { played.push(this.src.split('/').pop()); return playImpl(); }
    };
    const adapter = createWebNotifyAdapter();
    bridge = (e) => {
        const soundId = e && e.detail && e.detail.soundId;
        if (typeof soundId === 'string') adapter.playSound(soundId);
    };
    window.addEventListener(SOUND_PREVIEW_EVENT, bridge);
});

afterEach(() => {
    window.removeEventListener(SOUND_PREVIEW_EVENT, bridge);
    globalThis.Audio = priorAudio;
    cleanup();
    vi.clearAllMocks();
});

describe('Notification Sounds field and the Choose Sound page', () => {
    it('opens Choose Sound from the field, with the current sound ticked and nothing played', async () => {
        renderSettings('notifications-sounds');
        fireEvent.click(await field('Governance polls'));
        await screen.findByRole('heading', { level: 1, name: 'Choose Sound' });
        // Governance polls defaults to Bong.
        await waitFor(() => expect(ticked()).toEqual(['bong']));
        expect(row('bong').getAttribute('aria-current')).toBe('true');
        expect(played).toEqual([]);
        expect(messaging.updateSettings).not.toHaveBeenCalled();
    });

    it('a row pick plays that sound once and saves; Back shows it on the field', async () => {
        renderSettings('notifications-sounds');
        fireEvent.click(await field('Deadlines'));
        await screen.findByRole('heading', { level: 1, name: 'Choose Sound' });
        await waitFor(() => expect(row('glass')).toBeTruthy());
        const glassIcon = row('glass').querySelector('svg').outerHTML;
        fireEvent.click(row('glass'));
        expect(played).toEqual(['glass.mp3']);
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ sounds: { perKind: { deadlines: 'glass' } } }));
        expect(messaging.updateSettings).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(ticked()).toEqual(['glass']));
        // The master switch is off: the preview played anyway, once.
        expect(settings.sounds.enabled).toBe(false);
        expect(played).toEqual(['glass.mp3']);
        fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
        await screen.findByRole('heading', { level: 1, name: 'Notification Sounds' });
        const pickedField = await field('Deadlines');
        expect(pickedField).toHaveAccessibleName('Deadlines sound: Glass');
        expect(pickedField.querySelector('[data-list-field-icon] svg').outerHTML).toBe(glassIcon);
        expect(played).toEqual(['glass.mp3']);
    });

    it('No sound plays nothing and saves the none sentinel', async () => {
        renderSettings(`notifications-sound:priceAlerts`);
        await screen.findByRole('heading', { level: 1, name: 'Choose Sound' });
        await waitFor(() => expect(row(SOUND_NONE)).toBeTruthy());
        fireEvent.click(row(SOUND_NONE));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ sounds: { perKind: { priceAlerts: SOUND_NONE } } }));
        expect(played).toEqual([]);
        await waitFor(() => expect(ticked()).toEqual([SOUND_NONE]));
    });

    it('a mount of either page plays nothing', async () => {
        renderSettings('notifications-sounds');
        await field('Transaction confirmations');
        cleanup();
        renderSettings('notifications-sound:messages');
        await screen.findByRole('heading', { level: 1, name: 'Choose Sound' });
        await waitFor(() => expect(ticked()).toEqual(['ping']));
        expect(played).toEqual([]);
    });

    it('a refused play (autoplay blocked) stays silent: no notice, the pick still saves', async () => {
        playImpl = () => Promise.reject(new Error('NotAllowedError'));
        renderSettings('notifications-sound:incomingReceipts');
        await screen.findByRole('heading', { level: 1, name: 'Choose Sound' });
        await waitFor(() => expect(row('drop')).toBeTruthy());
        fireEvent.click(row('drop'));
        expect(played).toEqual(['drop.mp3']);
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(screen.queryByText(/could not/i)).toBeNull();
        expect(ticked()).toEqual(['drop']);
    });
});
