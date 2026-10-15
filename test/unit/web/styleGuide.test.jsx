// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';
import {
    Guidance,
    Markup,
    SECTIONS,
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

const styleGuideCss = readFileSync(resolve(
    import.meta.dirname,
    '../../../packages/web/src/style-guide/style-guide.css',
), 'utf8');
const narrowMarker = '@media (max-width: 600px) {';
const originalInnerWidth = window.innerWidth;

function installNarrowStyles() {
    const narrowStart = styleGuideCss.indexOf(narrowMarker);
    const base = styleGuideCss.slice(0, narrowStart);
    const narrow = styleGuideCss.slice(
        narrowStart + narrowMarker.length,
        styleGuideCss.lastIndexOf('}'),
    );
    const style = document.createElement('style');
    style.dataset.testNarrowStyleGuide = '';
    style.textContent = `${base}\n${narrow}`;
    document.head.appendChild(style);
}

afterEach(() => {
    cleanup();
    document.querySelectorAll('[data-test-narrow-style-guide]')
        .forEach((style) => style.remove());
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalInnerWidth,
    });
    document.documentElement.removeAttribute('data-xc-theme');
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

    it('renders the page as a usable single column at 360px', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
        installNarrowStyles();
        window.history.replaceState({}, '', '/style-guide?view=mobile');
        const { container } = render(<StyleGuidePage />);

        const page = container.querySelector('.sg-page');
        const sections = [...page.querySelectorAll(':scope > .sg-section')];
        const guide = page.querySelector('.sg-guide dl');
        const codeSample = page.querySelector('.sg-markup pre');
        const frameScroller = page.querySelector('.sg-frame-scroll');
        const triptych = page.querySelector('.sg-triptych');
        const triptychCell = page.querySelector('.sg-triptych-cell');
        const switcher = screen.getByRole('group', { name: 'Preview width' });
        const buttons = screen.getAllByRole('button', { name: /px/ });

        expect(sections).toHaveLength(SECTIONS.length);
        for (const section of sections) expect(getComputedStyle(section).display).toBe('block');
        expect(getComputedStyle(guide).gridTemplateColumns).toBe('minmax(0, 1fr)');
        expect(getComputedStyle(codeSample).overflowX).toBe('auto');
        expect(getComputedStyle(codeSample).maxWidth).toBe('100%');
        expect(getComputedStyle(frameScroller).overflowX).toBe('auto');
        expect(getComputedStyle(frameScroller).maxWidth).toBe('100%');
        expect(getComputedStyle(triptych).gridTemplateColumns).toBe('minmax(0, 1fr)');
        expect(getComputedStyle(triptychCell).overflowX).toBe('auto');
        expect(getComputedStyle(triptychCell).width).toBe('100%');
        expect(getComputedStyle(page).boxSizing).toBe('border-box');
        expect(getComputedStyle(page).width).toBe('100%');
        expect(getComputedStyle(page).overflowWrap).toBe('anywhere');
        expect(getComputedStyle(switcher).display).toBe('flex');
        expect(getComputedStyle(switcher).width).toBe('100%');
        for (const button of buttons) {
            expect(getComputedStyle(button).flexGrow).toBe('1');
            expect(getComputedStyle(button).minWidth).toBe('0');
        }

        fireEvent.click(screen.getByRole('button', { name: /Extension/ }));
        expect(screen.getByRole('button', { name: /Extension/ })).toHaveAttribute('aria-pressed', 'true');
        expect(window.location.search).toBe('?view=extension');
    });

    it.each(
        Object.values(VIEWS).flatMap((view) => (
            ['light', 'dark'].map((theme) => [view.id, theme])
        )),
    )('has no serious or critical axe violations in the %s view with the %s theme', async (view, theme) => {
        window.history.replaceState({}, '', `/style-guide?view=${view}`);
        document.documentElement.setAttribute('data-xc-theme', theme);
        const { container } = render(<StyleGuidePage />);

        await expectNoSeriousAxeViolations(container, { iframes: false });
    });
});
