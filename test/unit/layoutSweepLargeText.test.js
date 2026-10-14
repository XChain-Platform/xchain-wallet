// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    applyFontScale, expectedRootFontPx, installFontScale, measureControlRows, rootFontFailure,
} from '../e2e/layout/sweep.js';
import controlRowsConfig from '../e2e/playwright.control-rows.config.js';
import { selectVenues } from '../e2e/playwright.layout.config.js';

describe('layout sweep large-text venue', () => {
    it('starts every document with the native font-scale bootstrap value', async () => {
        const page = { addInitScript: vi.fn(async (script, scale) => script(scale)) };
        try {
            await installFontScale(page, 1.5);
            expect(page.addInitScript).toHaveBeenCalledOnce();
            expect(window.__xchainNativeFontScale).toBe(1.5);
        } finally {
            delete window.__xchainNativeFontScale;
        }
    });

    it('sends the app font-scale event and waits for the root size to follow', async () => {
        const seen = [];
        const listener = (event) => seen.push(event.detail.fontScale);
        window.addEventListener('xchain:native-font-scale', listener);
        const page = {
            evaluate: vi.fn(async (fn, arg) => fn(arg)),
            waitForFunction: vi.fn(async () => {}),
        };
        try {
            await applyFontScale(page, 1.3);
        } finally {
            window.removeEventListener('xchain:native-font-scale', listener);
        }
        expect(seen).toEqual([1.3]);
        expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), 16 * 1.3, { timeout: 10_000 });
    });

    it('leaves the default venue unchanged', async () => {
        const page = { addInitScript: vi.fn(), evaluate: vi.fn() };
        await installFontScale(page);
        await applyFontScale(page);
        expect(page.addInitScript).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
        expect(expectedRootFontPx(undefined)).toBeNull();
    });

    it('fails a screen measured at a root size other than the scaled one', () => {
        expect(rootFontFailure({ label: 'home', rootFontPx: 24, expectedRootFontPx: 24 })).toBeNull();
        expect(rootFontFailure({ label: 'home', rootFontPx: 16 })).toBeNull();
        expect(rootFontFailure({ label: 'home', rootFontPx: 16, expectedRootFontPx: 24 }))
            .toBe('home: root font size 16px, expected 24px');
    });

    it('keeps the large-text projects opt-in', () => {
        const defaults = selectVenues().map((project) => project.name);
        expect(defaults).not.toContain('android-lg-k51-large-text');
        expect(defaults).not.toContain('android-lg-k51-largest-text');
        expect(selectVenues('android-lg-k51-large-text,android-lg-k51-largest-text')).toEqual([
            expect.objectContaining({ name: 'android-lg-k51-large-text', metadata: { fontScale: 1.3 } }),
            expect.objectContaining({ name: 'android-lg-k51-largest-text', metadata: { fontScale: 1.5 } }),
        ]);
    });
});

describe('layout sweep control rows', () => {
    const rect = (left, top, width, height) => ({
        left, top, width, height, right: left + width, bottom: top + height,
    });
    const place = (element, box) => {
        element.getBoundingClientRect = () => box;
    };

    it('reports height, radius, and font differences while allowing equal-height icon buttons', () => {
        document.body.innerHTML = `
            <div id="text-row" style="display: flex">
                <button style="border-radius: 4px; font-size: 14px">Cancel</button>
                <button style="border-radius: 8px; font-size: 16px">Continue</button>
            </div>
            <div id="icon-row" style="display: flex">
                <button aria-label="Previous" style="border-radius: 50%; font-size: 12px"><svg></svg></button>
                <button aria-label="Next" style="border-radius: 2px; font-size: 20px"><svg></svg></button>
            </div>
            <div id="tolerance-row" style="display: flex">
                <button style="border-radius: 4px; font-size: 14px">Back</button>
                <button style="border-radius: 4px; font-size: 14px">Save</button>
            </div>
        `;
        const [cancel, proceed] = document.querySelectorAll('#text-row button');
        const [previous, next] = document.querySelectorAll('#icon-row button');
        const [back, save] = document.querySelectorAll('#tolerance-row button');
        place(cancel, rect(0, 0, 80, 40));
        place(proceed, rect(88, 0, 100, 43));
        place(previous, rect(0, 60, 40, 40));
        place(next, rect(48, 60, 40, 40));
        place(back, rect(0, 120, 60, 40));
        place(save, rect(68, 120, 60, 42));

        expect(measureControlRows()).toEqual([
            expect.objectContaining({
                problems: ['height', 'border-radius', 'font-size'],
                controls: [
                    expect.objectContaining({ el: 'button "Cancel"', height: 40, iconOnly: false }),
                    expect.objectContaining({ el: 'button "Continue"', height: 43, iconOnly: false }),
                ],
            }),
        ]);
    });

    it('runs the route sweep at each required width', () => {
        expect(controlRowsConfig.projects.map((project) => project.use.viewport.width))
            .toEqual([360, 768, 1280]);
    });
});
