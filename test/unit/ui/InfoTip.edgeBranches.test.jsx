// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { InfoTip } from '../../../packages/core/src/ui/InfoTip.jsx';
import styles from '../../../packages/core/src/ui/InfoTip.module.css';

const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');

afterEach(() => {
    cleanup();
    if (originalVisualViewport) {
        Object.defineProperty(window, 'visualViewport', originalVisualViewport);
    } else {
        delete window.visualViewport;
    }
});

describe('<InfoTip> edge branches', () => {
    it('stays open on mouse leave while focused, then closes on outside blur', () => {
        render(<InfoTip label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });

        fireEvent.mouseEnter(trigger);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        trigger.focus();
        fireEvent.mouseLeave(trigger);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();

        fireEvent.blur(trigger, { relatedTarget: document.body });
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('opens with Space, prevents scrolling, and applies a custom wrapper class', () => {
        render(<InfoTip label="Explanation" className="extra-tip" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        const event = createEvent.keyDown(trigger, { key: ' ' });
        fireEvent(trigger, event);

        expect(event.defaultPrevented).toBe(true);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        expect(trigger.parentElement).toHaveClass('extra-tip');
    });

    it('flips a bottom placement above when only the upper side fits', () => {
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: {
                width: 320,
                height: 240,
                offsetLeft: 0,
                offsetTop: 0,
                addEventListener() {},
                removeEventListener() {},
            },
        });
        render(<InfoTip label="Explanation" placement="bottom" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        const wrap = trigger.parentElement;
        const tooltip = screen.getByRole('tooltip', { hidden: true });
        wrap.getBoundingClientRect = () => ({ left: 140, right: 164, top: 210, bottom: 234, width: 24, height: 24 });
        tooltip.getBoundingClientRect = () => ({ width: 130, height: 80 });
        Object.defineProperty(tooltip, 'scrollHeight', { configurable: true, value: 80 });

        fireEvent.click(trigger);

        expect(screen.getByRole('tooltip')).toHaveClass(styles.placementTop);
        expect(screen.getByRole('tooltip')).toHaveStyle({ maxHeight: '196px' });
    });

    it('recomputes position from visual viewport resize events and detaches listeners', () => {
        const listeners = new Map();
        const viewport = {
            width: 300,
            height: 240,
            offsetLeft: 0,
            offsetTop: 0,
            addEventListener: vi.fn((name, callback) => listeners.set(name, callback)),
            removeEventListener: vi.fn(),
        };
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: viewport,
        });
        const view = render(<InfoTip label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        const wrap = trigger.parentElement;
        const tooltip = screen.getByRole('tooltip', { hidden: true });
        let left = 140;
        wrap.getBoundingClientRect = () => ({ left, right: left + 24, top: 100, bottom: 124, width: 24, height: 24 });
        tooltip.getBoundingClientRect = () => ({ width: 100, height: 40 });

        fireEvent.click(trigger);
        expect(screen.getByRole('tooltip').style.transform).toBe('translateX(var(--xc-tip-center, -50%)) translateX(0px)');

        left = 280;
        act(() => listeners.get('resize')());
        expect(screen.getByRole('tooltip').style.transform).not.toBe('translateX(var(--xc-tip-center, -50%)) translateX(0px)');

        view.unmount();
        expect(viewport.removeEventListener).toHaveBeenCalled();
    });
});
