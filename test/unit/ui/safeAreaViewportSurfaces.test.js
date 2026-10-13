// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import bottomBarStyles from '../../../packages/core/src/shared/components/BottomTabBar.module.css';
import layoutStyles from '../../../packages/core/src/shared/components/LeftNav.module.css';
import toastStyles from '../../../packages/core/src/shared/components/ToastHost.module.css';

vi.mock('../../../packages/core/src/shared/hooks/useHaptic.js', () => ({
    useHaptic: () => ({ error: vi.fn(), success: vi.fn(), tap: vi.fn() }),
    HapticProvider: ({ children }) => children,
}));

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const inset = (edge) => `env\\(safe-area-inset-${edge},\\s*0(?:px)?\\)`;
const h = React.createElement;

const bottomBarCss = read('packages/core/src/shared/components/BottomTabBar.module.css');
const layoutCss = read('packages/core/src/shared/components/LeftNav.module.css');
const toastCss = read('packages/core/src/shared/components/ToastHost.module.css');
const initialWidth = window.innerWidth;

function computedClassRules(element, moduleStyles, source) {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((match) => {
        const selector = match[1].trim();
        if (selector.startsWith('@')) return [];
        const renderedSelector = selector
            .replace(/:global\(([^)]+)\)/g, '$1')
            .replace(/\.([_a-zA-Z][\w-]*)/g, (classSelector, localName) => (
                moduleStyles[localName] ? `.${moduleStyles[localName]}` : classSelector
            ));
        try {
            return renderedSelector.split(',').some((part) => element.matches(part.trim()))
                ? [match[2]]
                : [];
        } catch {
            return [];
        }
    }).join('\n');
}

function renderShell(width) {
    window.innerWidth = width;
    return render(h(
        ToastHost,
        null,
        h(
            FullLayoutWithNav,
            {
                nav: h('nav', { 'data-testid': 'desktop-navigation' }),
                header: h(AppHeader),
                bottomBar: h(BottomTabBar, { currentView: 'home', onSelect: () => {} }),
            },
            h('main', null, 'Route'),
        ),
    ));
}

afterEach(() => {
    cleanup();
    window.innerWidth = initialWidth;
});

describe('viewport surfaces keep content inside device safe areas', () => {
    it('applies safe-area rules to the rendered compact header, tab bar, toast host, and sheet', () => {
        const { container } = renderShell(390);
        const layout = container.querySelector(`.${layoutStyles.layout}`);
        expect(layout).toHaveAttribute('data-xc-tier', 'compact');

        const appHeader = screen.getByRole('region', { name: 'App header' });
        const headerSlot = appHeader.closest(`.${layoutStyles.header}`);
        const headerRules = computedClassRules(headerSlot, layoutStyles, layoutCss);
        expect(headerRules).toMatch(new RegExp(`padding:[\\s\\S]*${inset('top')}`));
        expect(headerRules).toMatch(new RegExp(inset('right')));
        expect(headerRules).toMatch(new RegExp(inset('left')));
        expect(headerRules).toMatch(new RegExp(`margin-top:\\s*calc\\(0px - ${inset('top')}\\)`));
        expect(headerRules).toMatch(new RegExp(`margin-inline-start:\\s*calc\\(0px - ${inset('left')}\\)`));
        expect(headerRules).toMatch(new RegExp(`margin-inline-end:\\s*calc\\(0px - ${inset('right')}\\)`));

        const bottomBar = screen.getByRole('navigation', { name: 'Bottom navigation' });
        const bottomBarRules = computedClassRules(bottomBar, bottomBarStyles, bottomBarCss);
        expect(bottomBarRules).toMatch(new RegExp(`padding-bottom:\\s*${inset('bottom')}`));

        const toastHost = screen.getByRole('status', { name: 'Notifications' });
        const toastRules = computedClassRules(toastHost, toastStyles, toastCss);
        expect(toastRules).toMatch(new RegExp(inset('left')));
        expect(toastRules).toMatch(new RegExp(inset('right')));
        expect(toastRules).toMatch(new RegExp(inset('bottom')));

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        const sheet = screen.getByRole('dialog', { name: 'More' });
        const sheetRules = computedClassRules(sheet, bottomBarStyles, bottomBarCss);
        expect(sheetRules).toMatch(new RegExp(inset('right')));
        expect(sheetRules).toMatch(/env\(safe-area-inset-bottom,\s*var\(--xc-space-3\)\)/);
        expect(sheetRules).toMatch(new RegExp(inset('left')));
    });

    it('leaves the desktop header on the body inset instead of padding it twice', () => {
        renderShell(1440);
        const appHeader = screen.getByRole('region', { name: 'App header' });
        const headerSlot = appHeader.closest(`.${layoutStyles.header}`);
        const headerRules = computedClassRules(headerSlot, layoutStyles, layoutCss);

        expect(headerSlot.closest(`.${layoutStyles.layout}`)).toHaveAttribute('data-xc-tier', 'full');
        expect(headerRules).not.toMatch(/safe-area-inset-/);
        expect(screen.queryByRole('navigation', { name: 'Bottom navigation' })).toBeNull();
    });

    it.each([
        ['Alerts overlay', 'packages/core/src/shared/components/AlertsOverlay.module.css', '.overlay'],
        ['Notice modal', 'packages/core/src/shared/components/NoticeModal.module.css', '.overlay'],
        ['Gated file viewer', 'packages/core/src/shared/components/GatedFileViewer.module.css', '.overlay'],
        ['Contacts modal', 'packages/core/src/shared/routes/ContactsList.module.css', '.modalOverlay'],
    ])('%s pads all four viewport edges', (_name, path, selector) => {
        const css = read(path);
        const rule = css.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`))[0];

        for (const edge of ['top', 'right', 'bottom', 'left']) {
            expect(rule).toMatch(new RegExp(inset(edge)));
        }
    });

    it('keeps the bottom sheet above the home indicator and landscape cutouts', () => {
        const css = read('packages/core/src/shared/components/BottomTabBar.module.css');
        const sheet = css.match(/\.sheet\s*\{[^}]*\}/)[0];

        expect(sheet).toMatch(new RegExp(inset('right')));
        expect(sheet).toMatch(/env\(safe-area-inset-bottom,\s*var\(--xc-space-3\)\)/);
        expect(sheet).toMatch(new RegExp(inset('left')));
    });

    it('fits toasts between both landscape safe-area edges', () => {
        const css = read('packages/core/src/shared/components/ToastHost.module.css');
        const viewport = css.match(/\.viewport\s*\{[^}]*\}/)[0];

        expect(viewport).toMatch(new RegExp(inset('left')));
        expect(viewport).toMatch(new RegExp(inset('right')));
        expect(viewport).toMatch(new RegExp(inset('bottom')));
    });

    it('keeps the fixed undo action inside every adjacent device inset', () => {
        const css = read('packages/core/src/shared/components/UndoSendToast.module.css');
        const toast = css.match(/\.toast\s*\{[^}]*\}/)[0];

        expect(toast).toMatch(new RegExp(`inset-inline-start:[^;]*${inset('left')}`));
        expect(toast).toMatch(new RegExp(`inset-inline-end:[^;]*${inset('right')}`));
        expect(toast).toMatch(new RegExp(`bottom:[^}]*${inset('bottom')}`));
    });

    it('pads the inline History export modal on every viewport edge', () => {
        const history = read('packages/core/src/shared/routes/History.jsx');
        const scrim = history.match(/const MODAL_SCRIM = \{[^}]*\}/)[0];

        for (const edge of ['top', 'right', 'bottom', 'left']) {
            expect(scrim).toMatch(new RegExp(inset(edge)));
        }
    });

    it('offsets web-shell fixed and sticky tools from their anchored safe edges', () => {
        const badge = read('packages/web/src/DevVariantBadge.module.css');
        const styleGuide = read('packages/web/src/style-guide/style-guide.css');

        expect(badge).toMatch(new RegExp(inset('bottom')));
        expect(badge).toMatch(new RegExp(inset('left')));
        expect(styleGuide).toMatch(new RegExp(`top:\\s*${inset('top')}`));
    });
});
