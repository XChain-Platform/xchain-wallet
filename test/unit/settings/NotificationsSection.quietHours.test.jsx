// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Quiet hours editor: status card, switch, Starts and Ends rows and the
// draggable one-day range bar. Everything is always on screen; the switch only
// changes how the window is drawn.
//
// Operator notes 2026-11-15: the range slider looks like the Network fee
// slider (a plain 8px line with a 16px dot for each of its two thumbs), no
// separator lines between the fields, and the page is a Settings form page
// (no outer card below 600px, one centred card at the form column width from
// 600px; formFrame.test.jsx pins the frame). jsdom blanks CSS modules, so the
// look is read from the stylesheet as text; the headless run is the render.

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import {
    formatClock,
    formatHourLabel,
    quietSegments,
    snapMinutes,
    toClock,
    uses24HourClock,
} from '../../../packages/core/src/notifications/quietHoursTime.js';

let settings;
let update;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/hooks/usePriceAlerts.js', () => ({
    usePriceAlerts: () => ({
        alerts: [], loading: false, supported: true, error: null,
        addAlert: vi.fn(), updateAlert: vi.fn(), removeAlert: vi.fn(), rearm: vi.fn(),
    }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging: {} }),
}));

const { NotificationsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NotificationsSection.jsx');

const priorNotification = globalThis.Notification;

// jsdom has no PointerEvent; a MouseEvent subclass carries clientX through.
if (typeof globalThis.PointerEvent === 'undefined') {
    globalThis.PointerEvent = class PointerEvent extends MouseEvent {
        constructor(type, init = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
        }
    };
}

beforeEach(() => {
    globalThis.Notification = { permission: 'granted', requestPermission: vi.fn(async () => 'granted') };
    settings = createDefaultSettings();
    settings.quietHours = { enabled: true, start: '22:00', end: '07:00' };
    update = vi.fn().mockResolvedValue(settings);
});

afterEach(() => {
    cleanup();
    globalThis.Notification = priorNotification;
});

function renderQuiet() {
    return render(<NotificationsSection only="quiet" />);
}
const startHandle = () => screen.getByRole('slider', { name: 'Quiet hours start' });
const endHandle = () => screen.getByRole('slider', { name: 'Quiet hours end' });

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/settings/NotificationsSection.module.css'),
    'utf8',
);
const feeCss = readFileSync(
    join(process.cwd(), 'packages/core/src/ui/FeeSelector.module.css'),
    'utf8',
);
/** One rule's body from NotificationsSection.module.css, by its exact selector. */
function rule(selector, source = css) {
    const at = source.indexOf(`\n${selector} {`);
    expect(at, `rule ${selector}`).toBeGreaterThan(-1);
    return source.slice(at, source.indexOf('}', at));
}

describe('Quiet hours slider look (operator 2026-11-15: like the Network fee slider)', () => {
    it('draws one plain rounded line with the fee slider\'s 16px thumb as a dot per thumb', () => {
        renderQuiet();
        const bar = document.querySelector('[data-quiet-bar]');
        expect(bar.querySelectorAll('[data-quiet-line]')).toHaveLength(1);
        // Both thumbs sit on the one line, each a dot inside its slider.
        const dots = [startHandle(), endHandle()].map((h) => h.querySelector('[data-quiet-dot]'));
        expect(dots.every(Boolean)).toBe(true);
        expect(dots.every((d) => d.getAttribute('aria-hidden') === 'true')).toBe(true);
        // The line: 8px, fully rounded, the native track's light fill and edge.
        expect(rule('.line')).toMatch(/height:\s*8px;/);
        expect(rule('.line')).toMatch(/border-radius:\s*999px;/);
        // The dot: the fee slider's thumb size, round, in the accent colour.
        expect(feeCss).toMatch(/--fee-thumb:\s*16px;/);
        expect(rule('.dot')).toMatch(/width:\s*16px;/);
        expect(rule('.dot')).toMatch(/height:\s*16px;/);
        expect(rule('.dot')).toMatch(/border-radius:\s*50%;/);
        expect(rule('.dot')).toMatch(/background:\s*var\(--xc-accent-primary\);/);
        expect(rule('.fillOn')).toMatch(/var\(--xc-accent-primary\)/);
        // A tap-size hit box and the fee slider's focus ring.
        expect(rule('.handle')).toMatch(/width:\s*var\(--xc-tap-min\);/);
        expect(rule('.handle:focus-visible .dot')).toMatch(/outline:\s*2px solid var\(--xc-focus-ring\);/);
        // No box handle: no handle border or square corners.
        expect(rule('.handle')).not.toMatch(/border(-radius)?:/);
    });

    it('keeps each thumb a labelled slider that works from the keyboard', async () => {
        renderQuiet();
        for (const h of [startHandle(), endHandle()]) {
            expect(h.getAttribute('tabindex')).toBe('0');
            expect(h.getAttribute('aria-orientation')).toBe('horizontal');
        }
        fireEvent.keyDown(endHandle(), { key: 'ArrowRight' });
        await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ quietHours: { enabled: true, start: '22:00', end: '07:15' } }));
    });
});

describe('Quiet hours fields (operator 2026-11-15: no separators)', () => {
    it('draws no divider between Pause notifications, the slider, Starts and Ends, nor under Ends', () => {
        renderQuiet();
        const rows = [...document.querySelectorAll('[data-quiet-row]')];
        expect(rows.map((r) => r.getAttribute('data-quiet-row'))).toEqual(['switch', 'bar', 'start', 'end']);
        for (const row of rows) {
            // No settings-row surface: its inset divider was the separator line.
            expect(row.getAttribute('style') || '').not.toMatch(/box-shadow|border/);
        }
        for (const selector of ['.form', '.field', '.track']) {
            expect(rule(selector)).not.toMatch(/border|box-shadow/);
        }
    });

    it('spaces the notice and the fields by the form gap alone', () => {
        const { container } = renderQuiet();
        const form = container.firstElementChild;
        expect(form.firstElementChild.getAttribute('role')).toBe('status');
        expect([...form.children].filter((el) => el.hasAttribute('data-quiet-row'))).toHaveLength(4);
        expect(rule('.form')).toMatch(/gap:\s*var\(--xc-form-gap\);/);
        expect(rule('.form > *')).toMatch(/margin-block:\s*0;/);
    });
});

function structure(container) {
    // Tag names and roles only: text and styling may differ between on and off.
    return Array.from(container.querySelectorAll('*'))
        .map((el) => `${el.tagName}${el.getAttribute('role') ? `:${el.getAttribute('role')}` : ''}`)
        .join('|');
}

describe('quiet hours time helpers', () => {
    it('formats 12-hour by default and 24-hour on request', () => {
        expect(formatClock(0)).toBe('12:00 AM');
        expect(formatClock(7 * 60)).toBe('7:00 AM');
        expect(formatClock(12 * 60)).toBe('12:00 PM');
        expect(formatClock(22 * 60 + 15)).toBe('10:15 PM');
        expect(formatClock(22 * 60, true)).toBe('22:00');
        expect(formatHourLabel(0)).toBe('12 AM');
        expect(formatHourLabel(18)).toBe('6 PM');
        expect(formatHourLabel(24)).toBe('12 AM');
        expect(formatHourLabel(6, true)).toBe('06');
    });

    it('snaps to 15 minutes and wraps a day', () => {
        expect(snapMinutes(7)).toBe(0);
        expect(snapMinutes(8)).toBe(15);
        expect(snapMinutes(1439)).toBe(0);
        expect(toClock(-15)).toBe('23:45');
        expect(toClock(1440 + 30)).toBe('00:30');
    });

    it('splits a midnight-crossing window in two and leaves an equal one empty', () => {
        expect(quietSegments(22 * 60, 7 * 60)).toEqual([{ from: 0, to: 420 }, { from: 1320, to: 1440 }]);
        expect(quietSegments(9 * 60, 17 * 60)).toEqual([{ from: 540, to: 1020 }]);
        expect(quietSegments(600, 600)).toEqual([]);
    });

    it('follows the language clock, 12-hour by default', () => {
        expect(uses24HourClock({})).toBe(false);
        expect(uses24HourClock({ language: 'en' })).toBe(false);
        expect(uses24HourClock({ language: 'de' })).toBe(true);
        expect(uses24HourClock({ language: 'not a locale!!' })).toBe(false);
    });
});

describe('Quiet hours editor', () => {
    it('shows the same structure on and off, with the window in the muted line colour when off', () => {
        const on = renderQuiet();
        const onShape = structure(on.container);
        expect(on.container.querySelector('[data-quiet-status]').textContent).toBe('Quiet from 10:00 PM to 7:00 AM');
        expect(on.container.querySelector('[data-quiet-bar]').getAttribute('data-quiet-bar')).toBe('on');
        cleanup();

        settings.quietHours = { enabled: false, start: '22:00', end: '07:00' };
        const off = renderQuiet();
        expect(structure(off.container)).toBe(onShape);
        expect(off.container.querySelector('[data-quiet-status]').textContent).toBe('Off, notifications any time');
        expect(off.container.querySelector('[data-quiet-bar]').getAttribute('data-quiet-bar')).toBe('off');
        // Off draws the window in the muted line colour (.fillOff), on in the
        // accent (.fillOn); a dashed box cannot sit on an 8px line.
        const seg = off.container.querySelector('[data-quiet-segment]');
        expect(seg.getAttribute('data-quiet-segment')).toBe('off');
        expect(rule('.fillOff')).toMatch(/background:\s*var\(--xc-border\);/);
        expect(rule('.fillOn')).toMatch(/background:\s*var\(--xc-accent-primary\);/);
        // Starts and Ends stay in view and editable while off.
        expect(document.getElementById('quiet-hours-start').value).toBe('22:00');
        expect(document.getElementById('quiet-hours-end').value).toBe('07:00');
        expect(startHandle()).toBeTruthy();
    });

    it('draws two parts across midnight and one part inside a day', () => {
        const { container, rerender } = renderQuiet();
        expect(container.querySelectorAll('[data-quiet-segment]').length).toBe(2);
        cleanup();
        settings.quietHours = { enabled: true, start: '09:00', end: '17:00' };
        const second = renderQuiet();
        expect(second.container.querySelectorAll('[data-quiet-segment]').length).toBe(1);
        expect(rerender).toBeTypeOf('function');
    });

    it('saves a switch change at once and keeps the times', async () => {
        renderQuiet();
        fireEvent.click(screen.getByRole('switch', { name: 'Pause notifications' }));
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        expect(update).toHaveBeenCalledWith({ quietHours: { enabled: false, start: '22:00', end: '07:00' } });
    });

    it('makes each handle a slider with 12-hour value text', () => {
        renderQuiet();
        expect(startHandle().getAttribute('aria-valuetext')).toBe('10:00 PM');
        expect(endHandle().getAttribute('aria-valuetext')).toBe('7:00 AM');
        expect(startHandle().getAttribute('aria-valuenow')).toBe(String(22 * 60));
    });

    it('moves a handle 15 minutes on arrows and an hour on Page keys, storing HH:MM', async () => {
        renderQuiet();
        fireEvent.keyDown(startHandle(), { key: 'ArrowRight' });
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        expect(update).toHaveBeenLastCalledWith({ quietHours: { enabled: true, start: '22:15', end: '07:00' } });

        fireEvent.keyDown(endHandle(), { key: 'PageDown' });
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
        expect(update).toHaveBeenLastCalledWith({ quietHours: { enabled: true, start: '22:00', end: '06:00' } });

        fireEvent.keyDown(endHandle(), { key: 'ArrowLeft' });
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(3));
        expect(update).toHaveBeenLastCalledWith({ quietHours: { enabled: true, start: '22:00', end: '06:45' } });

        fireEvent.keyDown(endHandle(), { key: 'a' });
        expect(update).toHaveBeenCalledTimes(3);
    });

    it('wraps a handle past midnight', async () => {
        settings.quietHours = { enabled: true, start: '23:45', end: '07:00' };
        renderQuiet();
        fireEvent.keyDown(startHandle(), { key: 'ArrowUp' });
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        expect(update).toHaveBeenLastCalledWith({ quietHours: { enabled: true, start: '00:00', end: '07:00' } });
    });

    it('drags a handle live and saves once on release', async () => {
        const { container } = renderQuiet();
        const track = container.querySelector('[data-quiet-bar]');
        track.getBoundingClientRect = () => ({ left: 0, width: 960, top: 0, height: 28, right: 960, bottom: 28 });
        // 960 px for 1440 min: 1 px is 1.5 min; x=240 is 6:00 AM.
        fireEvent.pointerDown(endHandle(), { clientX: 0, pointerId: 1 });
        fireEvent.pointerMove(endHandle(), { clientX: 240, pointerId: 1 });
        expect(endHandle().getAttribute('aria-valuetext')).toBe('6:00 AM');
        expect(document.getElementById('quiet-hours-end').value).toBe('06:00');
        expect(update).not.toHaveBeenCalled();
        fireEvent.pointerUp(endHandle(), { clientX: 240, pointerId: 1 });
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        expect(update).toHaveBeenLastCalledWith({ quietHours: { enabled: true, start: '22:00', end: '06:00' } });
    });

    it('updates the bar from the Starts field', async () => {
        renderQuiet();
        fireEvent.change(document.getElementById('quiet-hours-start'), { target: { value: '21:30' } });
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        expect(update).toHaveBeenLastCalledWith({ quietHours: { enabled: true, start: '21:30', end: '07:00' } });
    });

    it('labels times in 24-hour form when the language runs a 24-hour clock', () => {
        settings.language = 'de';
        const { container } = renderQuiet();
        expect(container.querySelector('[data-quiet-status]').textContent).toBe('Quiet from 22:00 to 07:00');
        expect(startHandle().getAttribute('aria-valuetext')).toBe('22:00');
        expect(container.textContent).toContain('12');
        expect(container.textContent).not.toMatch(/\bPM\b/);
    });

    it('keeps the stored values as 24-hour HH:MM strings whatever the display', () => {
        renderQuiet();
        expect(document.getElementById('quiet-hours-start').value).toBe('22:00');
        expect(settings.quietHours).toEqual({ enabled: true, start: '22:00', end: '07:00' });
    });
});
