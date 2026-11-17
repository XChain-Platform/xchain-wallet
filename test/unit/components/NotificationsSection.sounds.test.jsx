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
// Each family's field is the standard picker field (ListField) and opens the
// Choose Sound page (operator 2026-11-15): one list card of the palette plus
// No sound, the current sound ticked. A row tap previews (the core
// SOUND_PREVIEW_EVENT window event, which only the web host listens for) and
// saves; mount and re-render never play.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import {
    SOUND_FAMILIES,
    SOUND_NONE,
    SOUND_NONE_OPTION,
    SOUND_PALETTE,
    SOUND_PREVIEW_EVENT,
} from '../../../packages/core/src/notifications/notificationSounds.js';
import * as SoundIcons from '../../../packages/core/src/ui/icons/index.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { supportsNotificationSoundPlayback } from '../../../packages/web/src/messaging.js';

// Mutable per-test state, read through the mocked hooks below.
let settings = createDefaultSettings();
let update = vi.fn();
let messaging = { supportsNotificationSoundPlayback };
let shell = 'popup';
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

const { NotificationsSection, SoundPickerPage, SOUND_PICKER_PAGE_PREFIX, soundChoices, soundPickerSectionFor } = await import(
    '../../../packages/core/src/shared/components/settings/NotificationsSection.jsx');

/** Turn the master on with the given per-family picks already stored. */
function soundsOn(perKind = {}) {
    settings = { ...createDefaultSettings(), sounds: { enabled: true, perKind } };
}

const soundSelect = (label) => screen.getByRole('button', { name: new RegExp(`^${label} sound:`) });
const soundSelects = () => Array.from(document.querySelectorAll('[data-sound-row] button[id^="notification-sound-"]'));

beforeEach(() => {
    settings = createDefaultSettings();
    update = vi.fn(async () => settings);
    messaging = { supportsNotificationSoundPlayback };
    shell = 'popup';
    previews = [];
    window.addEventListener(SOUND_PREVIEW_EVENT, onPreview);
});

afterEach(() => {
    window.removeEventListener(SOUND_PREVIEW_EVENT, onPreview);
    cleanup();
    vi.clearAllMocks();
});

describe('the notification-sounds master toggle', () => {
    it('renders off with every picker already visible on a default record', () => {
        render(<NotificationsSection />);
        const master = screen.getByRole('switch', { name: 'Play notification sounds' });
        expect(master.checked).toBe(false);
        for (const family of SOUND_FAMILIES) {
            expect(soundSelect(family.label)).toBeTruthy();
        }
    });

    it('off and on render the same rows, never dimmed', () => {
        const names = () => soundSelects().map((control) => control.getAttribute('aria-label'));
        const groups = () => screen.getAllByRole('group').map((g) => g.textContent);
        render(<NotificationsSection only="sounds" />);
        const offNames = names();
        const offGroups = groups();
        expect(document.querySelector('[style*="opacity"]')).toBeNull();
        cleanup();
        soundsOn();
        render(<NotificationsSection only="sounds" />);
        expect(names()).toEqual(offNames);
        expect(groups().length).toBe(offGroups.length);
        expect(document.querySelector('[style*="opacity"]')).toBeNull();
        expect(offNames).toHaveLength(10);
    });

    it('splits the rows into Payments, Messages and governance, and Trading', () => {
        render(<NotificationsSection only="sounds" />);
        const groups = screen.getAllByRole('group');
        expect(groups).toHaveLength(3);
        expect(screen.getByText('Payments')).toBeTruthy();
        expect(screen.getByText('Messages and governance')).toBeTruthy();
        expect(screen.getByText('Trading')).toBeTruthy();
        expect(groups[0].querySelectorAll('[data-sound-row] button[id^="notification-sound-"]')).toHaveLength(3);
        expect(groups[1].querySelectorAll('[data-sound-row] button[id^="notification-sound-"]')).toHaveLength(3);
        expect(groups[2].querySelectorAll('[data-sound-row] button[id^="notification-sound-"]')).toHaveLength(4);
    });

    it('renders every sound choice as a standard full-width labelled field', () => {
        render(<NotificationsSection only="sounds" />);
        const rows = document.querySelectorAll('[data-sound-row]');
        expect(rows).toHaveLength(SOUND_FAMILIES.length);
        for (const [index, row] of [...rows].entries()) {
            const family = SOUND_FAMILIES[index];
            const trigger = row.querySelector('button[id^="notification-sound-"]');
            expect(trigger).toBeTruthy();
            // The standard picker field (ListField), never a dropdown (2026-11-15).
            expect(trigger.getAttribute('aria-haspopup')).toBeNull();
            expect(trigger).toHaveAccessibleName(new RegExp(`^${family.label} sound:`));
            expect(row).toHaveTextContent(`${family.label} sound`);
            expect(row.querySelector('[data-sound-end]')).toBeNull();
            expect(row.querySelector('select')).toBeNull();
        }
    });

    it('writes a top-level sounds patch when switched on', async () => {
        render(<NotificationsSection />);
        fireEvent.click(screen.getByRole('switch', { name: 'Play notification sounds' }));
        expect(update).toHaveBeenCalledTimes(1);
        // Top-level, and only the master: nesting it under the flags or
        // sending the whole record would freeze the rest on first change.
        expect(update).toHaveBeenCalledWith({ sounds: { enabled: true } });
    });

    it('writes enabled:false when switched back off', async () => {
        soundsOn();
        render(<NotificationsSection />);
        const master = screen.getByRole('switch', { name: 'Play notification sounds' });
        expect(master.checked).toBe(true);
        fireEvent.click(master);
        expect(update).toHaveBeenCalledWith({ sounds: { enabled: false } });
    });
});

describe('the per-family sound fields', () => {
    it('renders one per family, each showing the sound that would play', () => {
        soundsOn();
        render(<NotificationsSection />);
        expect(SOUND_FAMILIES).toHaveLength(10);
        for (const family of SOUND_FAMILIES) {
            const selected = SOUND_PALETTE.find((sound) => sound.id === family.defaultSound)?.label;
            expect(soundSelect(family.label)).toHaveAccessibleName(`${family.label} sound: ${selected}`);
        }
        // The named case from the spec, spelled out rather than derived.
        expect(soundSelect('Incoming pending payments')).toHaveAccessibleName('Incoming pending payments sound: Pluck');
    });

    it('shows a stored pick rather than the family default, and No sound for the none sentinel', () => {
        soundsOn({ incomingPending: 'bong', deadlines: SOUND_NONE });
        render(<NotificationsSection />);
        expect(soundSelect('Incoming pending payments')).toHaveAccessibleName('Incoming pending payments sound: Bong');
        expect(soundSelect('Deadlines')).toHaveAccessibleName('Deadlines sound: No sound');
        // A sibling family is untouched by that pick.
        expect(soundSelect('Price alerts')).toHaveAccessibleName('Price alerts sound: Bell');
    });

    it('falls back to the family default for an id the palette no longer knows', () => {
        soundsOn({ incomingPending: 'retired-in-v9' });
        render(<NotificationsSection />);
        expect(soundSelect('Incoming pending payments')).toHaveAccessibleName('Incoming pending payments sound: Pluck');
    });

    it('opens that family\'s Choose Sound page from the field, and writes nothing itself', () => {
        const onOpenPage = vi.fn();
        render(<NotificationsSection only="sounds" onOpenPage={onOpenPage} />);
        fireEvent.click(soundSelect('Governance polls'));
        expect(onOpenPage).toHaveBeenCalledTimes(1);
        expect(onOpenPage).toHaveBeenCalledWith(`${SOUND_PICKER_PAGE_PREFIX}governancePolls`);
        expect(update).not.toHaveBeenCalled();
        expect(previews).toEqual([]);
    });

    it('resolves a Choose Sound page id for every family and nothing else', () => {
        for (const family of SOUND_FAMILIES) {
            const section = soundPickerSectionFor(`${SOUND_PICKER_PAGE_PREFIX}${family.key}`);
            expect(section.title).toBe('Choose Sound');
            expect(section.props).toEqual({ familyKey: family.key });
            expect(section.flat).toBe(true);
        }
        expect(soundPickerSectionFor(`${SOUND_PICKER_PAGE_PREFIX}notAFamily`)).toBeNull();
        expect(soundPickerSectionFor('notifications-sounds')).toBeNull();
        expect(soundPickerSectionFor(null)).toBeNull();
    });
});

describe('the Choose Sound page', () => {
    const rowsOf = () => [...document.querySelectorAll('[data-settings-choice]')];
    const rowButton = (value) => document.querySelector(`[data-settings-choice="${value}"] button`);
    const ticked = () => rowsOf().filter((li) => li.querySelector('[data-settings-choice-check]')).map((li) => li.getAttribute('data-settings-choice'));

    it('gives every sound one distinct icon and uses a muted speaker for No sound', () => {
        const iconNames = SOUND_PALETTE.map((sound) => sound.icon);
        expect(iconNames.every(Boolean)).toBe(true);
        expect(new Set(iconNames).size).toBe(SOUND_PALETTE.length);
        expect(SOUND_NONE_OPTION.icon).toBe('MutedSpeakerIcon');

        const choices = soundChoices();
        for (const sound of SOUND_PALETTE) {
            const choice = choices.find((option) => option.value === sound.id);
            expect(typeof SoundIcons[sound.icon], sound.id).toBe('function');
            expect(choice.glyph, sound.id).toBe(SoundIcons[sound.icon]);
        }
        expect(choices.find((option) => option.value === SOUND_NONE).glyph).toBe(SoundIcons.MutedSpeakerIcon);
    });

    it('lists the whole palette plus No sound in one list card', () => {
        render(<SoundPickerPage familyKey="incomingPending" />);
        expect(rowsOf().map((li) => li.getAttribute('data-settings-choice'))).toEqual([...SOUND_PALETTE.map((s) => s.id), SOUND_NONE]);
        expect(document.querySelectorAll('[data-settings-choice-list]')).toHaveLength(1);
        expect(rowButton(SOUND_NONE)).toHaveTextContent('No sound');
        // Rows, not a dropdown or radio group.
        expect(document.querySelector('[aria-haspopup="listbox"]')).toBeNull();
        expect(document.querySelector('input[type="radio"]')).toBeNull();
    });

    it('ticks the current sound only: the stored pick, else the family default', () => {
        render(<SoundPickerPage familyKey="incomingPending" />);
        expect(ticked()).toEqual(['pluck']);
        expect(rowButton('pluck').getAttribute('aria-current')).toBe('true');
        cleanup();
        soundsOn({ incomingPending: 'bong' });
        render(<SoundPickerPage familyKey="incomingPending" />);
        expect(ticked()).toEqual(['bong']);
        expect(rowButton('pluck').getAttribute('aria-current')).toBeNull();
    });

    it('plays nothing on mount, re-render or a family change', () => {
        const { rerender } = render(<SoundPickerPage familyKey="incomingPending" />);
        rerender(<SoundPickerPage familyKey="incomingPending" />);
        rerender(<SoundPickerPage familyKey="deadlines" />);
        expect(previews).toEqual([]);
        expect(update).not.toHaveBeenCalled();
    });

    it('a row pick plays that sound once, ticks it and saves ONE family key', async () => {
        render(<SoundPickerPage familyKey="incomingPending" />);
        fireEvent.click(rowButton('bong'));
        expect(previews).toEqual(['bong']);
        expect(ticked()).toEqual(['bong']);
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        expect(update).toHaveBeenCalledWith({ sounds: { perKind: { incomingPending: 'bong' } } });
    });

    it('plays the pick even while Play notification sounds is off', () => {
        settings = { ...createDefaultSettings(), sounds: { enabled: false, perKind: {} } };
        render(<SoundPickerPage familyKey="governancePolls" />);
        fireEvent.click(rowButton('glass'));
        expect(previews).toEqual(['glass']);
    });

    it('re-tapping the ticked sound plays it again without a save', () => {
        render(<SoundPickerPage familyKey="incomingPending" />);
        fireEvent.click(rowButton('pluck'));
        expect(previews).toEqual(['pluck']);
        expect(update).not.toHaveBeenCalled();
    });

    it('No sound plays nothing and saves the none sentinel', async () => {
        render(<SoundPickerPage familyKey="priceAlerts" />);
        fireEvent.click(rowButton(SOUND_NONE));
        expect(previews).toEqual([]);
        expect(ticked()).toEqual([SOUND_NONE]);
        await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ sounds: { perKind: { priceAlerts: SOUND_NONE } } }));
    });

    it('previews in narrow web but stays silent in the extension with the same popup layout', async () => {
        render(<SoundPickerPage familyKey="priceAlerts" />);
        fireEvent.click(rowButton('bong'));
        expect(previews).toEqual(['bong']);
        cleanup();

        messaging = {};
        render(<SoundPickerPage familyKey="priceAlerts" />);
        fireEvent.click(rowButton('bong'));
        expect(previews).toEqual(['bong']);
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    });

    it('never raises a notification event: a preview is not a delivery', () => {
        const seen = [];
        const onNotify = (e) => seen.push(e.detail);
        window.addEventListener('xchain:notification', onNotify);
        render(<SoundPickerPage familyKey="incomingPending" />);
        fireEvent.click(rowButton('bong'));
        window.removeEventListener('xchain:notification', onNotify);
        expect(previews).toEqual(['bong']);
        expect(seen).toEqual([]);
    });

    it('a failed save puts the tick back and says so', async () => {
        update = vi.fn(async () => { throw new Error('locked'); });
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<SoundPickerPage familyKey="incomingPending" />);
        fireEvent.click(rowButton('bong'));
        expect(await screen.findByText(/Couldn't save this notification sound/)).toBeTruthy();
        expect(ticked()).toEqual(['pluck']);
        spy.mockRestore();
    });
});

describe('the Quiet hours page is one flat card of rows', () => {
    // A bordered or card-surfaced box nested in the page card is the
    // card-in-a-card the operator ruled out.
    // A row takes its surface from the Settings page (the settings-row vars,
    // with the card vars only as a fallback), so a card edge that is not that
    // var is a nested box.
    const ownCardEdge = (el) => {
        const style = el.getAttribute('style') || '';
        return /var\(--xc-card-(border|bg)\)/.test(style.replace(/var\(--xc-settings-row-[a-z]+, var\(--xc-card-[a-z-]+\)\)/g, ''));
    };

    it('has no nested card and no duplicated summary block', () => {
        render(<NotificationsSection only="quiet" />);
        const rows = [...document.querySelectorAll('[data-quiet-row]')];
        expect(rows.map((r) => r.getAttribute('data-quiet-row'))).toEqual(['switch', 'bar', 'start', 'end']);
        // No row sits inside another row, and nothing on the page draws its own card edge.
        for (const row of rows) {
            expect(row.parentElement.closest('[data-quiet-row]')).toBeNull();
        }
        for (const el of document.querySelectorAll('[style]')) {
            expect(ownCardEdge(el)).toBe(false);
        }
        // The old caption block is gone; one status line stays on the switch row.
        expect(document.querySelectorAll('[data-quiet-status]')).toHaveLength(1);
        expect(screen.queryByText('Every day, your device\'s local time.')).toBeNull();
        expect(screen.queryByText('Quiet hours')).toBeNull();
        expect(document.querySelector('[data-quiet-status]').textContent).toBe('Off, notifications any time');
        // The explanation is one top notice, not a loose footnote.
        expect(screen.getAllByText(/your device's local time/i)).toHaveLength(1);
        expect(screen.getByText(/your device's local time/i).closest('[role="status"]')).toBeTruthy();
    });

    it('keeps the switch, both sliders and both time fields by name', () => {
        render(<NotificationsSection only="quiet" />);
        expect(screen.getByRole('switch', { name: 'Pause notifications' })).toBeTruthy();
        expect(screen.getAllByRole('slider')).toHaveLength(2);
        expect(document.getElementById('quiet-hours-start')).toBeTruthy();
        expect(document.getElementById('quiet-hours-end')).toBeTruthy();
    });
});

// Operator notes on Notification Sounds (2026-11-15). jsdom blanks CSS
// modules, so the rules are read as text; the headless run at 360, 411 and
// 1280 is the rendered proof (no separators, notice 8px under the header like
// Price Alerts, a 16px section gap above each group title).
describe('the Notification Sounds page layout', () => {
    const css = readFileSync(
        join(process.cwd(), 'packages/core/src/shared/components/settings/NotificationsSection.module.css'),
        'utf8',
    );
    const rule = (selector) => {
        const at = css.indexOf(`\n${selector} {`);
        expect(at, `rule ${selector}`).toBeGreaterThan(-1);
        return css.slice(at, css.indexOf('}', at));
    };

    it('draws no separator under Play notification sounds or between fields', () => {
        render(<NotificationsSection only="sounds" />);
        const master = document.querySelector('[data-sounds-field="master"]');
        expect(master).toBeTruthy();
        expect(master.contains(screen.getByRole('switch', { name: 'Play notification sounds' }))).toBe(true);
        // No settings-row surface (its inset divider) on any part of the form.
        for (const el of document.querySelectorAll('[data-sounds-form] [style]')) {
            expect(el.getAttribute('style')).not.toMatch(/box-shadow|border-(top|bottom)|--xc-settings-row-divider/);
        }
        for (const selector of ['.form', '.field', '.soundGroups', '.soundGroup']) {
            expect(rule(selector)).not.toMatch(/border|box-shadow/);
        }
    });

    it('zeroes the notice margin so the notice starts one gap under the header', () => {
        render(<NotificationsSection only="sounds" />);
        const form = document.querySelector('[data-sounds-form]');
        expect(form.firstElementChild.getAttribute('role')).toBe('status');
        expect(rule('.form > *')).toMatch(/margin-block:\s*0;/);
    });

    it('spaces the groups a section gap apart, the first one too', () => {
        expect(rule('.soundGroups')).toMatch(/gap:\s*var\(--xc-space-4\);/);
        expect(rule('.soundGroups')).toMatch(/padding-block-start:\s*max\(0rem, calc\(var\(--xc-space-4\) - var\(--xc-form-gap\)\)\);/);
        // Inside a group the fields keep the form gap.
        expect(rule('.soundGroup')).toMatch(/gap:\s*var\(--xc-form-gap\);/);
        render(<NotificationsSection only="sounds" />);
        const groups = screen.getAllByRole('group');
        expect(groups.map((g) => g.parentElement)).toEqual([groups[0].parentElement, groups[0].parentElement, groups[0].parentElement]);
    });
});

describe('notification permission feedback', () => {
    it('shows a request failure and uses the on-accent text token', async () => {
        const prior = globalThis.Notification;
        globalThis.Notification = {
            permission: 'default',
            requestPermission: vi.fn(async () => { throw new Error('denied by browser'); }),
        };
        try {
            render(<NotificationsSection />);
            const button = screen.getByRole('button', { name: 'Request Permission' });
            expect(button.className).toMatch(/success/);
            expect(button.style.color).toBe('');
            expect(button.querySelector('svg path[d^="M18 8a6 6"]')).not.toBeNull();
            fireEvent.click(button);
            expect(await screen.findByText(/Could not request notification permission/)).toBeTruthy();
        } finally {
            globalThis.Notification = prior;
        }
    });
});
