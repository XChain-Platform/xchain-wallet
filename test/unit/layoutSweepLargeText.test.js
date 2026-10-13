// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { installRootFontSize } from '../e2e/layout/sweep.js';
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
