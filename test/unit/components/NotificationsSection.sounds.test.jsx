// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Sounds block in the Notifications panel (spec §6 M4.2).
//
// Three things a source grep cannot tell you, and all three are the
// feature's contract: the pickers exist ONLY while the master toggle is
// on, each picker shows what would actually play (the stored pick, else
// the family's palette default), and each write is a single-family patch
// so picking one sound cannot clobber the other nine.
//
// Preview is the shell-capability half: the button dispatches the core
// SOUND_PREVIEW_EVENT window event, which only the web host listens for, and
// it must be absent rather than dead on the shells without the seam.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import {
    SOUND_FAMILIES,
    SOUND_NONE,
    SOUND_PALETTE,
    SOUND_PREVIEW_EVENT,
} from '../../../packages/core/src/notifications/notificationSounds.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

// Mutable per-test state, read through the mocked hooks below.
let settings = createDefaultSettings();
let update = vi.fn();
let messaging = {};
let shell = 'web';
let previews = [];
const onPreview = (e) => previews.push(e.detail && e.detail.soundId);

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update, refresh: async () => {} }),
}));

// The price-alert manager sits in the same panel and is not under test;
// stub its hook so this file is about the sounds block and nothing else.
vi.mock('../../../packages/core/src/shared/hooks/usePriceAlerts.js', () => ({
    usePriceAlerts: () => ({
        alerts: [],
        supported: false,
        addAlert: async () => {},
        removeAlert: async () => {},
        rearm: async () => {},
    }),
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell, messaging }),
}));

const { NotificationsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NotificationsSection.jsx');

/** Turn the master on with the given per-family picks already stored. */
function soundsOn(perKind = {}) {
    settings = { ...createDefaultSettings(), sounds: { enabled: true, perKind } };
}

beforeEach(() => {
    settings = createDefaultSettings();
    update = vi.fn(async () => settings);
    messaging = {};
    shell = 'web';
    previews = [];
    window.addEventListener(SOUND_PREVIEW_EVENT, onPreview);
});

afterEach(() => {
    window.removeEventListener(SOUND_PREVIEW_EVENT, onPreview);
    cleanup();
    vi.clearAllMocks();
});

describe('the notification-sounds master toggle', () => {
    it('renders off, with no pickers behind it, on a default record', () => {
        render(<NotificationsSection />);
        const master = screen.getByRole('switch', { name: 'Notification sounds' });
        expect(master.checked).toBe(false);
        // Not merely hidden: nothing to tab into, nothing to read out.
        for (const family of SOUND_FAMILIES) {
            expect(screen.queryByLabelText(`${family.label} sound`)).toBeNull();
        }
        expect(screen.queryByText('Preview')).toBeNull();
    });

    it('writes a top-level sounds patch when switched on', async () => {
        render(<NotificationsSection />);
        fireEvent.click(screen.getByRole('switch', { name: 'Notification sounds' }));
        expect(update).toHaveBeenCalledTimes(1);
        // Top-level, and only the master: nesting it under the flags or
        // sending the whole record would freeze the rest on first change.
        expect(update).toHaveBeenCalledWith({ sounds: { enabled: true } });
    });

    it('writes enabled:false when switched back off', async () => {
        soundsOn();
        render(<NotificationsSection />);
        const master = screen.getByRole('switch', { name: 'Notification sounds' });
        expect(master.checked).toBe(true);
        fireEvent.click(master);
        expect(update).toHaveBeenCalledWith({ sounds: { enabled: false } });
    });
});

describe('the per-family pickers', () => {
    it('renders one per family, each showing the sound that would play', () => {
        soundsOn();
        render(<NotificationsSection />);
        expect(SOUND_FAMILIES).toHaveLength(10);
        for (const family of SOUND_FAMILIES) {
            const select = screen.getByLabelText(`${family.label} sound`);
            expect(select.value).toBe(family.defaultSound);
        }
        // The named case from the spec, spelled out rather than derived.
        expect(screen.getByLabelText('Incoming pending payments sound').value).toBe('pluck');
    });

    it('offers the whole palette plus a No sound option', () => {
        soundsOn();
        render(<NotificationsSection />);
        const select = screen.getByLabelText('Incoming pending payments sound');
        const values = [...select.options].map((o) => o.value);
        expect(values).toEqual([...SOUND_PALETTE.map((s) => s.id), SOUND_NONE]);
        const noSound = [...select.options].find((o) => o.value === SOUND_NONE);
        expect(noSound.textContent).toBe('No sound');
    });

    it('shows a stored pick rather than the family default', () => {
        soundsOn({ incomingPending: 'bong' });
        render(<NotificationsSection />);
        expect(screen.getByLabelText('Incoming pending payments sound').value).toBe('bong');
        // A sibling family is untouched by that pick.
        expect(screen.getByLabelText('Price alerts sound').value).toBe('bell');
    });

    it('falls back to the family default for an id the palette no longer knows', () => {
        soundsOn({ incomingPending: 'retired-in-v9' });
        render(<NotificationsSection />);
        expect(screen.getByLabelText('Incoming pending payments sound').value).toBe('pluck');
    });

    it('writes ONE family key on change, never the whole map', () => {
        soundsOn();
        render(<NotificationsSection />);
        fireEvent.change(screen.getByLabelText('Incoming pending payments sound'), {
            target: { value: 'bong' },
        });
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({ sounds: { perKind: { incomingPending: 'bong' } } });
    });

    it('writes the none sentinel when a family is muted', () => {
        soundsOn();
        render(<NotificationsSection />);
        fireEvent.change(screen.getByLabelText('Price alerts sound'), {
            target: { value: SOUND_NONE },
        });
        expect(update).toHaveBeenCalledWith({ sounds: { perKind: { priceAlerts: SOUND_NONE } } });
    });
});

describe('the Preview button', () => {
    it('dispatches the preview event carrying the picked sound for that family', () => {
        soundsOn({ priceAlerts: 'drop' });
        render(<NotificationsSection />);
        fireEvent.click(screen.getByLabelText('Preview Incoming pending payments sound'));
        // The pending family's default, not the re-picked price-alert one.
        expect(previews).toEqual(['pluck']);
    });

    it('previews a re-picked sound rather than the default', () => {
        soundsOn({ incomingPending: 'bong' });
        render(<NotificationsSection />);
        fireEvent.click(screen.getByLabelText('Preview Incoming pending payments sound'));
        expect(previews).toEqual(['bong']);
    });

    it('is disabled where the family is muted', () => {
        soundsOn({ incomingPending: SOUND_NONE });
        render(<NotificationsSection />);
        const btn = screen.getByLabelText('Preview Incoming pending payments sound');
        expect(btn.disabled).toBe(true);
        fireEvent.click(btn);
        expect(previews).toEqual([]);
        // Only the muted row is dead; the rest still preview.
        expect(screen.getByLabelText('Preview Price alerts sound').disabled).toBe(false);
    });

    it('is ABSENT on the shells without the delivery seam', () => {
        for (const other of ['desktop', 'popup']) {
            shell = other;
            soundsOn();
            render(<NotificationsSection />);
            expect(screen.queryByLabelText('Preview Incoming pending payments sound'), other).toBeNull();
            expect(screen.queryByText('Preview'), other).toBeNull();
            // The pickers still work there; only the button is gone.
            expect(screen.getByLabelText('Incoming pending payments sound')).toBeTruthy();
            cleanup();
        }
    });

    it('never raises a notification event: a preview is not a delivery', () => {
        const seen = [];
        const onNotify = (e) => seen.push(e.detail);
        window.addEventListener('xchain:notification', onNotify);
        soundsOn();
        render(<NotificationsSection />);
        fireEvent.click(screen.getByLabelText('Preview Incoming pending payments sound'));
        window.removeEventListener('xchain:notification', onNotify);
        expect(previews).toEqual(['pluck']);
        expect(seen).toEqual([]);
    });
});
