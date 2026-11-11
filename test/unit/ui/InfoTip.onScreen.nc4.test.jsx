// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InfoTip } from '../../../packages/core/src/ui/InfoTip.jsx';
import styles from '../../../packages/core/src/ui/InfoTip.module.css';

const VIEWPORTS = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
];
const HEADER_BOTTOM = 64;
const BOTTOM_BAR_HEIGHT = 64;
const BUBBLE_GAP = 6;
const BUBBLE_SIZE = { width: 240, height: 72 };

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
const originalClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
const originalClientHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight');

function restore(target, name, descriptor) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete target[name];
}

function rect({ left = 0, top = 0, width = 0, height = 0 }) {
    return {
        left,
        right: left + width,
        top,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON() {},
    };
}

function px(value) {
    return value ? Number.parseFloat(value) : Infinity;
}

function positionedBox(tooltip, triggerBox) {
    const width = Math.min(BUBBLE_SIZE.width, px(tooltip.style.maxWidth));
    const height = Math.min(BUBBLE_SIZE.height, px(tooltip.style.maxHeight));
    const offsetMatch = tooltip.style.transform.match(/translateX\((-?[\d.]+)px\)$/);
    const horizontalOffset = offsetMatch ? Number.parseFloat(offsetMatch[1]) : 0;
    const left = triggerBox.left + triggerBox.width / 2 - width / 2 + horizontalOffset;
    const top = tooltip.classList.contains(styles.placementBottom)
        ? triggerBox.bottom + BUBBLE_GAP
        : triggerBox.top - BUBBLE_GAP - height;
    return rect({ left, top, width, height });
}

function edgeCases(width, height) {
    const bottomBarTop = height - BOTTOM_BAR_HEIGHT;
    return [
        ['left edge', rect({ left: 0, top: 220, width: 24, height: 24 })],
        ['right edge', rect({ left: width - 24, top: 220, width: 24, height: 24 })],
        ['just under header', rect({ left: width / 2 - 12, top: HEADER_BOTTOM + 1, width: 24, height: 24 })],
        ['just above bottom bar', rect({ left: width / 2 - 12, top: bottomBarTop - 25, width: 24, height: 24 })],
    ];
}

afterEach(() => {
    cleanup();
    restore(window, 'innerWidth', originalInnerWidth);
    restore(window, 'innerHeight', originalInnerHeight);
    restore(document.documentElement, 'clientWidth', originalClientWidth);
    restore(document.documentElement, 'clientHeight', originalClientHeight);
});

describe('<InfoTip> on-screen placement', () => {
    for (const viewport of VIEWPORTS) {
        for (const [position, triggerBox] of edgeCases(viewport.width, viewport.height)) {
            it(`stays between shell chrome at ${viewport.width}px from the ${position}`, () => {
                Object.defineProperty(window, 'innerWidth', {
                    configurable: true,
                    value: viewport.width,
                });
                Object.defineProperty(window, 'innerHeight', {
                    configurable: true,
                    value: viewport.height,
                });
                Object.defineProperty(document.documentElement, 'clientWidth', {
                    configurable: true,
                    value: viewport.width,
                });
                Object.defineProperty(document.documentElement, 'clientHeight', {
                    configurable: true,
                    value: viewport.height,
                });

                render(
                    <>
                        <section role="region" aria-label="App header" data-testid="app-header">
                            <button type="button" data-header-control>Menu</button>
                        </section>
                        <InfoTip label="A long enough explanation to use the measured tooltip box." />
                        <nav aria-label="Bottom navigation" data-testid="bottom-nav">
                            <button type="button" data-bottom-tab>Home</button>
                        </nav>
                    </>,
                );

                const header = screen.getByTestId('app-header');
                const bottomNav = screen.getByTestId('bottom-nav');
                const trigger = screen.getByRole('button', { name: 'More info' });
                const wrapper = trigger.parentElement;
                const tooltip = screen.getByRole('tooltip', { hidden: true });
                const bottomBarTop = viewport.height - BOTTOM_BAR_HEIGHT;
                header.getBoundingClientRect = () => rect({ width: viewport.width, height: HEADER_BOTTOM });
                bottomNav.getBoundingClientRect = () => rect({
                    top: bottomBarTop,
                    width: viewport.width,
                    height: BOTTOM_BAR_HEIGHT,
                });
                trigger.getBoundingClientRect = () => triggerBox;
                wrapper.getBoundingClientRect = () => triggerBox;
                tooltip.getBoundingClientRect = () => rect(BUBBLE_SIZE);
                Object.defineProperty(tooltip, 'scrollHeight', {
                    configurable: true,
                    value: BUBBLE_SIZE.height,
                });

                fireEvent.click(trigger);

                const box = positionedBox(screen.getByRole('tooltip'), triggerBox);
                expect(box.left).toBeGreaterThanOrEqual(0);
                expect(box.right).toBeLessThanOrEqual(viewport.width);
                expect(box.top).toBeGreaterThanOrEqual(HEADER_BOTTOM);
                expect(box.bottom).toBeLessThanOrEqual(bottomBarTop);
            });
        }
    }
});
