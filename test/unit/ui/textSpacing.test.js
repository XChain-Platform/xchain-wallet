// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clippedTextContainers } from '../../e2e/fixtures/textSpacing.js';

const stylesheet = readFileSync(
    join(process.cwd(), 'test/e2e/fixtures/text-spacing.css'),
    'utf8',
);

function setBoxMetrics(element, { clientHeight, scrollHeight, clientWidth = 100 }) {
    Object.defineProperties(element, {
        clientHeight: { configurable: true, value: clientHeight },
        clientWidth: { configurable: true, value: clientWidth },
        scrollHeight: { configurable: true, value: scrollHeight },
    });
}

afterEach(() => {
    document.body.replaceChildren();
});

describe('WCAG text-spacing fixture', () => {
    it('applies all four WCAG 1.4.12 spacing values', () => {
        expect(stylesheet).toMatch(/line-height:\s*1\.5\s*!important/);
        expect(stylesheet).toMatch(/margin-bottom:\s*2em\s*!important/);
        expect(stylesheet).toMatch(/letter-spacing:\s*0\.12em\s*!important/);
        expect(stylesheet).toMatch(/word-spacing:\s*0\.16em\s*!important/);
    });

    it('reports clipped text in a fixed-height container', () => {
        const clipped = document.createElement('div');
        clipped.textContent = 'Text that needs a taller line box';
        clipped.style.overflowY = 'hidden';
        setBoxMetrics(clipped, { clientHeight: 20, scrollHeight: 32 });
        document.body.append(clipped);

        expect(clippedTextContainers(document)).toEqual([expect.objectContaining({
            element: 'div',
            text: 'Text that needs a taller line box',
            clientHeight: 20,
            scrollHeight: 32,
        })]);
    });

    it('accepts content-sized, scrollable, and assistive-only containers', () => {
        const contentSized = document.createElement('div');
        contentSized.textContent = 'Content-sized text';
        contentSized.style.overflowY = 'hidden';
        setBoxMetrics(contentSized, { clientHeight: 32, scrollHeight: 32 });

        const scrollable = document.createElement('div');
        scrollable.textContent = 'Intentionally scrollable text';
        scrollable.style.overflowY = 'auto';
        setBoxMetrics(scrollable, { clientHeight: 20, scrollHeight: 32 });

        const hidden = document.createElement('span');
        hidden.textContent = 'Assistive text';
        hidden.style.position = 'absolute';
        hidden.style.clipPath = 'inset(50%)';
        hidden.style.overflowY = 'hidden';
        setBoxMetrics(hidden, { clientHeight: 1, clientWidth: 1, scrollHeight: 20 });

        document.body.append(contentSized, scrollable, hidden);
        expect(clippedTextContainers(document)).toEqual([]);
    });
});
