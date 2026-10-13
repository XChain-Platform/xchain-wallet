// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
    Guidance,
    Markup,
    Section,
    StyleGuidePage,
} from '../../../packages/web/src/style-guide/StyleGuidePage.jsx';
import {
    DEFAULT_VIEW,
    VIEWS,
    readViewFromUrl,
    writeViewToUrl,
} from '../../../packages/web/src/style-guide/frames.jsx';

const sectionModules = import.meta.glob(
    '../../../packages/web/src/style-guide/sections/*.jsx',
    { eager: true },
);

afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
});

describe('style guide catalog', () => {
    it('loads every catalog section with at least one component export', () => {
        expect(Object.keys(sectionModules).length).toBeGreaterThan(30);
        for (const [path, exports] of Object.entries(sectionModules)) {
            expect(
                Object.values(exports).some((value) => typeof value === 'function'),
                path,
            ).toBe(true);
        }
        expect(StyleGuidePage).toBeTypeOf('function');
    });

    it('reads and writes the browser preview width through the URL', () => {
        expect(readViewFromUrl('?view=mobile')).toBe(VIEWS.mobile.id);
        expect(readViewFromUrl('?view=unknown')).toBe(DEFAULT_VIEW);

        window.history.replaceState({ source: 'test' }, '', '/style-guide?keep=1');
        writeViewToUrl('extension');
        expect(window.location.search).toBe('?keep=1&view=extension');

        writeViewToUrl(DEFAULT_VIEW);
        expect(window.location.search).toBe('?keep=1');
    });

    it('renders the shared documentation wrappers and optional guidance', () => {
        render(
            <Section id="buttons" title="Buttons" tag="core" kicker="Choose one action.">
                <Guidance
                    what="An action control"
                    when="The user can proceed"
                    doRule="Use a direct label"
                    dontRule="Use a vague label"
                    supersedes="hand-written buttons"
                />
                <Markup>{'<Button>Continue</Button>'}</Markup>
            </Section>,
        );

        expect(screen.getByRole('heading', { name: /Buttons/ })).not.toBeNull();
        expect(screen.getByText('Choose one action.')).not.toBeNull();
        expect(screen.getByText('An action control')).not.toBeNull();
        expect(screen.getByText('Use a direct label')).not.toBeNull();
        expect(screen.getByText(/hand-written buttons/)).not.toBeNull();
        expect(screen.getByText('<Button>Continue</Button>')).not.toBeNull();
    });
});
