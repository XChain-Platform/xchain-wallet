// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SECTIONS,
    StyleGuidePage,
} from '../../../packages/web/src/style-guide/StyleGuidePage.jsx';

// Examples portal into srcdoc iframes, which jsdom never loads, so the frames
// render their children inline here and the marks stay queryable.
vi.mock('../../../packages/web/src/style-guide/frames.jsx', async (importOriginal) => {
    const actual = await importOriginal();
    const Inline = ({ children }) => <div data-test-frame>{children}</div>;
    return { ...actual, ViewFrame: Inline, ViewportFrame: Inline };
});

afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
});

describe('style guide asset mark section', () => {
    it('registers an asset-mark entry in the catalog', () => {
        const entry = SECTIONS.find((section) => section.id === 'asset-mark');
        expect(entry, 'asset-mark entry').toBeDefined();
        expect(entry.Component).toBeTypeOf('function');
    });

    it('renders a titled asset mark section with the native, imageless and unknown-network marks', () => {
        window.history.replaceState({}, '', '/style-guide');
        const { container } = render(<StyleGuidePage />);

        const section = container.querySelector('section.sg-section#asset-mark');
        expect(section, 'section.sg-section#asset-mark').not.toBeNull();
        const heading = section.querySelector('h2');
        expect(heading).not.toBeNull();
        expect(heading.textContent.trim()).not.toBe('');
        expect(section.querySelectorAll('[data-asset-mark]')).toHaveLength(3);
    });
});
