// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DesignTokensSection,
    DOCUMENTED_TOKENS,
    TOKEN_GROUPS,
} from '../../../packages/web/src/style-guide/sections/DesignTokensSection.jsx';

vi.mock('../../../packages/web/src/style-guide/StyleGuidePage.jsx', () => ({
    Section: ({ children }) => <main>{children}</main>,
    Guidance: () => null,
    LiveExample: ({ children }) => <section>{children}</section>,
}));

afterEach(() => {
    document.documentElement.removeAttribute('style');
});

describe('DesignTokensSection', () => {
    it('documents every token once and supplies every preview branch', () => {
        const catalogNames = TOKEN_GROUPS.flatMap(({ tokens }) => tokens.map(({ name }) => name));
        const previewKinds = new Set(
            TOKEN_GROUPS.flatMap(({ tokens }) => tokens.map(({ preview }) => preview)),
        );

        expect(DOCUMENTED_TOKENS).toEqual(catalogNames);
        expect(new Set(DOCUMENTED_TOKENS).size).toBe(DOCUMENTED_TOKENS.length);
        expect(previewKinds).toEqual(new Set([
            'color',
            'length',
            'radius',
            'shadow',
            'icon',
            'type',
            'font',
            'value',
        ]));
    });

    it('renders the complete catalog and replaces fallbacks with computed values', async () => {
        document.documentElement.style.setProperty('--xc-space-1', '17px');
        render(<DesignTokensSection />);

        for (const { title } of TOKEN_GROUPS) {
            expect(screen.getByRole('heading', { name: title })).not.toBeNull();
        }

        const renderedNames = screen.getAllByText(/^--xc-/).map((element) => element.textContent);
        expect(renderedNames).toEqual(DOCUMENTED_TOKENS);

        const name = screen.getByText('--xc-space-1');
        const row = name.parentElement.parentElement;
        await waitFor(() => expect(withinCodes(row)).toContain('17px'));
    });
});

function withinCodes(element) {
    return [...element.querySelectorAll('code')].map((node) => node.textContent);
}
