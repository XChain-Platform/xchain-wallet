// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// responsive-first, slice 2: the help dot grew a target without
// losing its name.
//
// The fix moved the painted circle off the <button> and onto an inner
// <span>, so the button could grow to the 24px pointer-target floor while
// the dot still looks like a 16px dot. The hazard in that shape is an
// accessibility one, not a visual one: a decorative inner span that
// forgot `aria-hidden` would put a stray "?" into the accessible name,
// and every screen reader would announce "Fee priority help question
// mark". jsdom cannot check the 24px (it performs no layout - the live
// proof is test/e2e/tests/responsive/viewports.spec.js), but it can check
// that the name survived the surgery.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { InfoTip } from '../../../packages/core/src/ui/InfoTip.jsx';
import infoTipStyles from '../../../packages/core/src/ui/InfoTip.module.css';
import { StatusMessage } from '../../../packages/core/src/ui/StatusMessage.jsx';
import statusStyles from '../../../packages/core/src/ui/StatusMessage.module.css';

const statusCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/ui/StatusMessage.module.css'),
    'utf8',
);
const infoTipCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/ui/InfoTip.module.css'),
    'utf8',
);

describe('InfoTip target (slice 2)', () => {
    afterEach(cleanup);

    it('keeps the trigger\'s accessible name exactly its aria label', () => {
        render(<InfoTip aria="Fee priority help" label="How fees work" />);
        const trigger = screen.getByRole('button', { name: 'Fee priority help' });
        expect(trigger).toBeTruthy();
        // Exact, not substring: the glyph must not leak "?" into the name.
        expect(trigger.getAttribute('aria-label')).toBe('Fee priority help');
    });

    it('paints the dot in an aria-hidden glyph inside the button', () => {
        render(<InfoTip aria="More info" label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        const glyph = trigger.querySelector('[aria-hidden="true"]');
        expect(glyph, 'the painted dot is a child of the target, not the target itself').toBeTruthy();
        expect(glyph.textContent).toBe('?');
    });

    it('opens on a touch tap and closes on a touch tap outside', () => {
        render(<InfoTip aria="More info" label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        expect(screen.queryByRole('tooltip')).toBeNull();
        fireEvent.pointerDown(trigger, { pointerType: 'touch' });
        fireEvent.click(trigger, { detail: 1 });
        expect(screen.getByRole('tooltip').textContent).toBe('Explanation');
        fireEvent.pointerDown(document.body, { pointerType: 'touch' });
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('does not activate a form control when the help button is inside its label', () => {
        render(
            <label>
                <input type="checkbox" />
                Enable advanced option
                <InfoTip aria="Advanced option help" label="Explanation" />
            </label>,
        );
        const checkbox = screen.getByRole('checkbox');

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Advanced option help' }), {
            pointerType: 'touch',
        });
        fireEvent.click(screen.getByRole('button', { name: 'Advanced option help' }));

        expect(checkbox).not.toBeChecked();
        expect(screen.getByRole('tooltip')).toHaveTextContent('Explanation');
    });

    it('opens from the keyboard and closes on Escape', () => {
        render(<InfoTip aria="More info" label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });

        fireEvent.focus(trigger);
        expect(screen.getByRole('tooltip')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('tooltip')).toBeNull();
        fireEvent.keyDown(trigger, { key: 'Enter' });
        expect(screen.getByRole('tooltip')).toBeTruthy();
    });

    it('attaches its screen-reader description before the trigger receives focus', () => {
        render(<InfoTip aria="More info" label="A useful explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        const tooltip = screen.getByRole('tooltip', { hidden: true });

        expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
        expect(trigger).toHaveAccessibleDescription('A useful explanation');
        expect(tooltip.hidden).toBe(true);
    });

    it('clamps the rendered bubble inside the right edge and flips below a top-edge trigger', () => {
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 });
        Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 240 });
        render(<InfoTip aria="More info" label="Explanation" placement="top" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        const wrap = trigger.parentElement;
        const tooltip = screen.getByRole('tooltip', { hidden: true });
        wrap.getBoundingClientRect = () => ({ left: 286, right: 310, top: 2, bottom: 26, width: 24, height: 24 });
        tooltip.getBoundingClientRect = () => ({ left: 183, right: 313, top: -84, bottom: -4, width: 130, height: 80 });

        fireEvent.focus(trigger);

        expect(screen.getByRole('tooltip').style.transform).toBe('translateX(-50%) translateX(-51px)');
        expect(screen.getByRole('tooltip').classList.contains(infoTipStyles.placementBottom)).toBe(true);
        expect(screen.getByRole('tooltip').style.maxHeight).toBe('200px');
        expect(screen.getByRole('tooltip').style.maxWidth).toBe('260px');
    });

    it('keeps the bubble margin when the trigger is against the left edge', () => {
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 });
        Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 240 });
        render(<InfoTip aria="More info" label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        const wrap = trigger.parentElement;
        const tooltip = screen.getByRole('tooltip', { hidden: true });
        wrap.getBoundingClientRect = () => ({ left: 1, right: 25, top: 100, bottom: 124, width: 24, height: 24 });
        tooltip.getBoundingClientRect = () => ({ left: -52, right: 78, top: 14, bottom: 94, width: 130, height: 80 });

        fireEvent.click(trigger);

        expect(screen.getByRole('tooltip').style.transform).toBe('translateX(-50%) translateX(60px)');
    });

    it('clamps to the visible viewport when a touch viewport is zoomed and panned', () => {
        const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: {
                width: 200,
                height: 180,
                offsetLeft: 50,
                offsetTop: 20,
                addEventListener() {},
                removeEventListener() {},
            },
        });

        try {
            render(<InfoTip aria="More info" label="Explanation" />);
            const trigger = screen.getByRole('button', { name: 'More info' });
            const wrap = trigger.parentElement;
            const tooltip = screen.getByRole('tooltip', { hidden: true });
            wrap.getBoundingClientRect = () => ({ left: 218, right: 242, top: 100, bottom: 124, width: 24, height: 24 });
            tooltip.getBoundingClientRect = () => ({ left: 165, right: 295, top: 14, bottom: 94, width: 130, height: 80 });

            fireEvent.click(trigger);

            expect(screen.getByRole('tooltip').style.transform).toBe('translateX(-50%) translateX(-53px)');
            expect(screen.getByRole('tooltip').style.minWidth).toBe('180px');
            expect(screen.getByRole('tooltip').style.maxWidth).toBe('184px');
        } finally {
            cleanup();
            if (originalVisualViewport) {
                Object.defineProperty(window, 'visualViewport', originalVisualViewport);
            } else {
                delete window.visualViewport;
            }
        }
    });

    it('lets long tooltip text wrap inside the viewport', () => {
        expect(infoTipCss).toMatch(/max-width:\s*min\(260px,\s*calc\(100vw/);
        expect(infoTipCss).toMatch(/overflow-wrap:\s*anywhere/);
    });

    it('uses a physical center anchor for viewport correction in RTL layouts', () => {
        expect(infoTipCss).toMatch(/\.bubble\s*\{[^}]*\bleft:\s*50%/s);
        expect(infoTipCss).not.toMatch(/\.bubble\s*\{[^}]*inset-inline-start:/s);
    });
});

describe('StatusMessage semantics and presentation', () => {
    afterEach(cleanup);

    it.each([
        ['status', 'status', 'polite', statusStyles.status],
        ['success', 'status', 'polite', statusStyles.success],
        ['error', 'alert', 'assertive', statusStyles.error],
    ])('maps %s to its role, live priority, and colour class', (variant, role, live, variantClass) => {
        render(<StatusMessage variant={variant}>Message</StatusMessage>);
        const message = screen.getByRole(role);

        expect(message.getAttribute('aria-live')).toBe(live);
        expect(message.getAttribute('aria-atomic')).toBe('true');
        expect(message.classList.contains(variantClass)).toBe(true);
    });

    it('maps each variant class to its semantic colour tokens', () => {
        expect(statusCss).toMatch(/\.row\.status\s*\{[^}]*background:\s*var\(--xc-bg-muted\)[^}]*color:\s*var\(--xc-text\)/s);
        expect(statusCss).toMatch(/\.row\.error\s*\{[^}]*background:\s*var\(--xc-danger\)[^}]*color:\s*var\(--xc-on-danger\)/s);
        expect(statusCss).toMatch(/\.row\.success\s*\{[^}]*background:\s*var\(--xc-success-bg,\s*rgba\(20, 111, 52, 0\.10\)\)/s);
        expect(statusCss).toMatch(/\.row\.success\s*\{[^}]*border:\s*1px solid var\(--xc-success,/s);
    });

    it('allows long unbroken messages to wrap', () => {
        expect(statusCss).toMatch(/\.text\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/s);
    });
});
