// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InfoTip } from '../../../packages/core/src/ui/InfoTip.jsx';

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
const originalClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
const originalClientHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight');

function restore(target, name, descriptor) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete target[name];
}

afterEach(() => {
    restore(window, 'innerWidth', originalInnerWidth);
    restore(window, 'innerHeight', originalInnerHeight);
    restore(document.documentElement, 'clientWidth', originalClientWidth);
    restore(document.documentElement, 'clientHeight', originalClientHeight);
});

describe('<InfoTip> remaining viewport and event branches', () => {
    it('keeps inside pointer actions open and closes on an unfocused mouse leave', () => {
        render(<InfoTip label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        fireEvent.mouseEnter(trigger);

        fireEvent.pointerDown(trigger);
        fireEvent.pointerDown(screen.getByRole('tooltip'));
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(screen.getByRole('tooltip')).toBeInTheDocument();

        fireEvent.mouseLeave(trigger);
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('keeps the tooltip open when focus moves inside the wrapper', () => {
        render(<InfoTip label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        const tooltip = screen.getByRole('tooltip', { hidden: true });
        tooltip.tabIndex = -1;

        fireEvent.focus(trigger);
        fireEvent.blur(trigger, { relatedTarget: tooltip });

        expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('clears layout constraints when no viewport dimensions are available', () => {
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 0 });
        Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 0 });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 });
        render(<InfoTip label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });

        fireEvent.click(trigger);

        const tooltip = screen.getByRole('tooltip');
        expect(tooltip.style.maxWidth).toBe('');
        expect(tooltip.style.maxHeight).toBe('');
        expect(tooltip.style.transform).toContain('translateX(0px)');
    });
});
