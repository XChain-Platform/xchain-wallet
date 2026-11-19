// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A field's '?' help popup opens fully on screen at every review size: never
// under the app header or the bottom bar, never clipped at either side, and
// on desktop never past the edges of the scrolling screen body beside the
// sidebar. The popup is measured at its widest (360px), so a phone width
// forces the cap to the screen and the sideways clamp. Rects are mocked and
// the component's own placement logic decides the side, width and offset.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InfoTip } from '../../../packages/core/src/ui/InfoTip.jsx';
import styles from '../../../packages/core/src/ui/InfoTip.module.css';

const HEADER_BOTTOM = 56;
const BOTTOM_BAR_HEIGHT = 64;
const SIDEBAR_WIDTH = 248;
const BUBBLE_GAP = 6;
const TRIGGER = 24;

// The review wall's sizes: phones and the extension popup have the bottom
// bar; desktop has a sidebar and a screen body that clips its overflow.
const SIZES = [
    { name: 'Android small 360', width: 360, height: 640, bottomBar: true },
    { name: 'extension popup 360', width: 360, height: 600, bottomBar: true },
    { name: 'iPhone 402', width: 402, height: 874, bottomBar: true },
    { name: 'desktop 1920', width: 1920, height: 1080, bottomBar: false, sidebar: true },
];

const BUBBLES = [
    { name: 'a short tip', width: 360, height: 60 },
    { name: 'a long tip', width: 360, height: 220 },
];

const originals = {
    innerWidth: Object.getOwnPropertyDescriptor(window, 'innerWidth'),
    innerHeight: Object.getOwnPropertyDescriptor(window, 'innerHeight'),
    clientWidth: Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth'),
    clientHeight: Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight'),
};

function restore(target, name, descriptor) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete target[name];
}

afterEach(() => {
    cleanup();
    restore(window, 'innerWidth', originals.innerWidth);
    restore(window, 'innerHeight', originals.innerHeight);
    restore(document.documentElement, 'clientWidth', originals.clientWidth);
    restore(document.documentElement, 'clientHeight', originals.clientHeight);
});

function rect({ left = 0, top = 0, width = 0, height = 0 }) {
    return { left, right: left + width, top, bottom: top + height, width, height, x: left, y: top, toJSON() {} };
}

function setViewport(width, height) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height });
}

/** The visible band a popup must stay inside at this size. */
function visibleArea(size) {
    return {
        left: size.sidebar ? SIDEBAR_WIDTH : 0,
        right: size.width,
        top: HEADER_BOTTOM,
        bottom: size.bottomBar ? size.height - BOTTOM_BAR_HEIGHT : size.height,
    };
}

/** Triggers at the corners and edges of the visible band, where clipping bites. */
function triggerSpots(area) {
    const middleX = (area.left + area.right) / 2 - TRIGGER / 2;
    const middleY = (area.top + area.bottom) / 2 - TRIGGER / 2;
    return [
        ['the first field just under the header', rect({ left: area.left, top: area.top + 2, width: TRIGGER, height: TRIGGER })],
        ['a label at the right edge under the header', rect({ left: area.right - TRIGGER, top: area.top + 2, width: TRIGGER, height: TRIGGER })],
        ['a label mid-screen', rect({ left: middleX, top: middleY, width: TRIGGER, height: TRIGGER })],
        ['the last field just above the bottom edge', rect({ left: area.left, top: area.bottom - TRIGGER - 2, width: TRIGGER, height: TRIGGER })],
        ['a label at the right edge above the bottom edge', rect({ left: area.right - TRIGGER, top: area.bottom - TRIGGER - 2, width: TRIGGER, height: TRIGGER })],
    ];
}

function px(value) {
    return value ? Number.parseFloat(value) : Infinity;
}

/** Where the popup paints, from the side, caps and offset the component set. */
function paintedBox(tooltip, trigger, bubble) {
    const width = Math.min(bubble.width, px(tooltip.style.maxWidth));
    const height = Math.min(bubble.height, px(tooltip.style.maxHeight));
    const offsetMatch = tooltip.style.transform.match(/translateX\((-?[\d.]+)px\)$/);
    const offset = offsetMatch ? Number.parseFloat(offsetMatch[1]) : 0;
    const left = trigger.left + trigger.width / 2 - width / 2 + offset;
    const top = tooltip.classList.contains(styles.placementBottom)
        ? trigger.bottom + BUBBLE_GAP
        : trigger.top - BUBBLE_GAP - height;
    return rect({ left, top, width, height });
}

function openTip(size, trigger, bubble) {
    setViewport(size.width, size.height);
    const area = visibleArea(size);
    render(
        <>
            <section role="region" aria-label="App header" data-testid="header">
                <button type="button" data-header-control>Menu</button>
            </section>
            <div data-testid="body" style={{ overflowX: 'hidden', overflowY: 'auto' }}>
                <InfoTip label="What this field means on this form, in one short sentence." />
            </div>
            {size.bottomBar ? (
                <nav aria-label="Bottom navigation" data-testid="bottom-bar">
                    <button type="button" data-bottom-tab>Home</button>
                </nav>
            ) : null}
        </>,
    );
    screen.getByTestId('header').getBoundingClientRect = () => rect({ width: size.width, height: HEADER_BOTTOM });
    screen.getByTestId('body').getBoundingClientRect = () => rect({
        left: area.left,
        top: HEADER_BOTTOM,
        width: area.right - area.left,
        height: area.bottom - HEADER_BOTTOM,
    });
    if (size.bottomBar) {
        screen.getByTestId('bottom-bar').getBoundingClientRect = () => rect({
            top: size.height - BOTTOM_BAR_HEIGHT,
            width: size.width,
            height: BOTTOM_BAR_HEIGHT,
        });
    }
    const button = screen.getByRole('button', { name: 'More info' });
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    button.getBoundingClientRect = () => trigger;
    button.parentElement.getBoundingClientRect = () => trigger;
    tooltip.getBoundingClientRect = () => rect({ width: bubble.width, height: bubble.height });
    Object.defineProperty(tooltip, 'scrollHeight', { configurable: true, value: bubble.height });
    fireEvent.click(button);
    return { area, tooltip: screen.getByRole('tooltip') };
}

describe('<InfoTip> popup at every review size', () => {
    for (const size of SIZES) {
        const area = visibleArea(size);
        for (const bubble of BUBBLES) {
            for (const [where, trigger] of triggerSpots(area)) {
                it(`keeps ${bubble.name} on screen at ${size.name} from ${where}`, () => {
                    const opened = openTip(size, trigger, bubble);
                    const box = paintedBox(opened.tooltip, trigger, bubble);
                    expect(box.left).toBeGreaterThanOrEqual(opened.area.left);
                    expect(box.right).toBeLessThanOrEqual(opened.area.right);
                    expect(box.top).toBeGreaterThanOrEqual(opened.area.top);
                    expect(box.bottom).toBeLessThanOrEqual(opened.area.bottom);
                });
            }
        }

        it(`caps the popup to the screen width at ${size.name}`, () => {
            const trigger = triggerSpots(area)[2][1];
            const { tooltip } = openTip(size, trigger, BUBBLES[0]);
            const usable = area.right - area.left - 16;
            expect(px(tooltip.style.maxWidth)).toBe(Math.min(360, usable));
        });
    }

    it('opens a tip on the first field below its label, not under the header', () => {
        const size = SIZES[0];
        const trigger = triggerSpots(visibleArea(size))[0][1];
        const { tooltip } = openTip(size, trigger, BUBBLES[0]);
        expect(tooltip.classList.contains(styles.placementBottom)).toBe(true);
    });
});
