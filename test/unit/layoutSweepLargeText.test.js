// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { installRootFontSize, measureControlRows } from '../e2e/layout/sweep.js';
import controlRowsConfig from '../e2e/playwright.control-rows.config.js';
import { selectVenues } from '../e2e/playwright.layout.config.js';

describe('layout sweep large-text venue', () => {
    it('sets the root font size through an init script on every document', async () => {
        const page = { addInitScript: vi.fn(async (script, size) => script(size)) };
        const originalDocument = globalThis.document;
        globalThis.document = { documentElement: { style: {} } };

        try {
            await installRootFontSize(page, '130%');
            expect(page.addInitScript).toHaveBeenCalledOnce();
            expect(globalThis.document.documentElement.style.fontSize).toBe('130%');
        } finally {
            globalThis.document = originalDocument;
        }
    });

    it('leaves the default venue unchanged', async () => {
        const page = { addInitScript: vi.fn() };
        await installRootFontSize(page);
        expect(page.addInitScript).not.toHaveBeenCalled();
    });

    it('keeps the large-text project opt-in', () => {
        expect(selectVenues().map((project) => project.name)).not.toContain('android-lg-k51-large-text');
        expect(selectVenues('android-lg-k51-large-text')).toEqual([
            expect.objectContaining({
                name: 'android-lg-k51-large-text',
                metadata: { rootFontSize: '130%' },
            }),
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
