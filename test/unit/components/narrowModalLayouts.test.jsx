// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AlertsOverlay } from '../../../packages/core/src/shared/components/AlertsOverlay.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { ConfirmModal } from '../../../packages/core/src/shared/components/ConfirmModal.jsx';
import { GatedFileViewer } from '../../../packages/core/src/shared/components/GatedFileViewer.jsx';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const COMPONENT_DIR = join(process.cwd(), 'packages/core/src/shared/components');
const UI_DIR = join(process.cwd(), 'packages/core/src/ui');
const VIEWPORT = { width: 320, height: 568 };

const css = (name) => readFileSync(join(COMPONENT_DIR, name), 'utf8');

function rule(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(text)?.[1] || '';
}

function modalFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return modalFiles(path);
        if (!entry.name.endsWith('.jsx')) return [];
        return readFileSync(path, 'utf8').includes('aria-modal="true"') ? [entry.name] : [];
    });
}

function expectPanelWithinViewport(panelRule, maxWidth) {
    expect(panelRule).toMatch(/box-sizing:\s*border-box/);
    expect(panelRule).toMatch(/width:\s*100%/);
    // A panel may cap itself with min(<width>, 100%), which is the same bound inside a 100%-wide box.
    expect(panelRule).toMatch(new RegExp(`max-width:\\s*(?:${maxWidth}px|min\\(${maxWidth}px,\\s*100%\\))\\s*;`));
}

beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT.width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT.height });
    Object.defineProperty(document.documentElement, 'clientWidth', {
        configurable: true,
        value: VIEWPORT.width,
    });
    Object.defineProperty(document.documentElement, 'clientHeight', {
        configurable: true,
        value: VIEWPORT.height,
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('320x568 modal inventory', () => {
    it('covers every modal dialog in shared components and ui', () => {
        expect([
            ...modalFiles(COMPONENT_DIR),
            ...modalFiles(UI_DIR),
        ].sort()).toEqual([
            'AlertsOverlay.jsx',
            'BottomTabBar.jsx',
            'ConfirmModal.jsx',
            'GatedFileViewer.jsx',
            'NoticeModal.jsx',
        ]);
    });
});

describe('320x568 modal renders', () => {
    it('keeps Notice content in a scroller and its close action in a footer', () => {
        render(
            <NoticeModal
                title="Notice"
                message={'Long content '.repeat(200)}
                onClose={() => {}}
            />,
        );

        const dialog = screen.getByRole('dialog', { name: 'Notice' });
        const close = screen.getByRole('button', { name: 'OK' });
        expect(close.parentElement).toBe(dialog.firstElementChild.lastElementChild);
        expect(close.parentElement.previousElementSibling).toHaveTextContent('Long content');
    });

    it('keeps Confirm content in a scroller and both actions in a footer', () => {
        render(
            <ConfirmModal
                title="Confirm deletion"
                message={'Long warning '.repeat(200)}
                onConfirm={() => {}}
                onCancel={() => {}}
            />,
        );

        const dialog = screen.getByRole('dialog', { name: 'Confirm deletion' });
        const actions = screen.getByRole('button', { name: 'Cancel' }).parentElement;
        expect(actions).toBe(dialog.firstElementChild.lastElementChild);
        expect(actions).toContainElement(screen.getByRole('button', { name: 'Confirm' }));
        expect(actions.previousElementSibling).toHaveTextContent('Long warning');
    });

    it('keeps the Alerts close control above its scrolling body', () => {
        const alerts = Array.from({ length: 20 }, (_, index) => ({
            id: String(index),
            severity: 'info',
            title: `Alert ${index}`,
            message: 'Detailed alert message',
        }));
        render(<AlertsOverlay alerts={alerts} onClose={() => {}} />);

        const panel = screen.getByRole('dialog', { name: /^Alerts/ }).firstElementChild;
        const close = screen.getByRole('button', { name: 'Close alerts' });
        expect(close).toBe(panel.firstElementChild.lastElementChild);
        expect(panel.lastElementChild).toContainElement(screen.getByText('Alert 19'));
    });

    it('keeps the file viewer actions after its scrolling preview', () => {
        render(
            <GatedFileViewer
                name="long.txt"
                declaredType="text/plain"
                plaintextBase64={btoa('long preview '.repeat(200))}
                onClose={() => {}}
            />,
        );

        const panel = screen.getByRole('dialog', { name: /long\.txt/ }).firstElementChild;
        const close = screen.getByRole('button', { name: 'Close' });
        expect(close.parentElement).toBe(panel.lastElementChild);
        expect(close.parentElement.previousElementSibling).toHaveTextContent('long preview');
    });

    it('keeps the More sheet close control above its scrolling navigation', () => {
        render(
            <BottomTabBar
                currentView="home"
                onSelect={() => {}}
                onLock={() => {}}
                onOpenSettings={() => {}}
                onOpenWalletPicker={() => {}}
                hasVmAddress
                hasDexSurface
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        const sheet = screen.getByRole('dialog', { name: 'More' });
        const close = screen.getByRole('button', { name: 'Close more navigation' });
        expect(sheet.firstElementChild).toContainElement(close);
        expect(close).toHaveClass(buttonStyles.md, buttonStyles.iconOnly);
        expect(sheet.lastElementChild).toContainElement(screen.getByRole('button', { name: 'Lock wallet' }));
        fireEvent.click(close);
        expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
    });
});

describe('320x568 modal layout contracts', () => {
    it('bounds centered dialogs and isolates their scrolling content', () => {
        const notice = css('NoticeModal.module.css');
        const noticePanel = rule(notice, '.panel');
        expectPanelWithinViewport(noticePanel, 320);
        expect(noticePanel).toMatch(/max-height:\s*calc\(/);
        expect(noticePanel).toMatch(/display:\s*flex/);
        expect(noticePanel).toMatch(/flex-direction:\s*column/);
        expect(noticePanel).toMatch(/overflow:\s*hidden/);
        expect(rule(notice, '.content')).toMatch(/min-height:\s*0/);
        expect(rule(notice, '.content')).toMatch(/flex:\s*1 1 auto/);
        expect(rule(notice, '.content')).toMatch(/overflow-y:\s*auto/);
        expect(rule(notice, '.actions')).toMatch(/flex:\s*0 0 auto/);

        const alerts = css('AlertsOverlay.module.css');
        expectPanelWithinViewport(rule(alerts, '.panel'), 380);
        expect(rule(alerts, '.header')).toMatch(/flex:\s*0 0 auto/);
        expect(rule(alerts, '.body')).toMatch(/min-height:\s*0/);
        expect(rule(alerts, '.body')).toMatch(/overflow-y:\s*auto/);

        const viewer = css('GatedFileViewer.module.css');
        expectPanelWithinViewport(rule(viewer, '.panel'), 520);
        expect(rule(viewer, '.body')).toMatch(/min-height:\s*0/);
        expect(rule(viewer, '.body')).toMatch(/overflow:\s*auto/);
        expect(rule(viewer, '.actions')).toMatch(/flex:\s*0 0 auto/);
    });

    it('bounds the bottom sheet and scrolls only the body below its close control', () => {
        const bottomBar = css('BottomTabBar.module.css');
        const sheet = rule(bottomBar, '.sheet');
        expect(sheet).toMatch(/box-sizing:\s*border-box/);
        expect(sheet).toMatch(/inset-inline-start:\s*0/);
        expect(sheet).toMatch(/inset-inline-end:\s*0/);
        expect(sheet).toMatch(/max-height:\s*70vh/);
        expect(sheet).toMatch(/overflow:\s*hidden/);
        expect(sheet).toMatch(/flex-direction:\s*column/);
        const sheetHeader = rule(bottomBar, '.sheetHeader');
        expect(sheetHeader).toMatch(/display:\s*grid/);
        expect(sheetHeader).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
        expect(sheetHeader).toMatch(/flex:\s*0 0 auto/);
        const sheetClose = rule(bottomBar, '.sheetClose');
        expect(sheetClose).toMatch(/width:\s*var\(--xc-control-h-md\)/);
        expect(sheetClose).toMatch(/height:\s*var\(--xc-control-h-md\)/);
        expect(sheetClose).not.toMatch(/position:\s*absolute/);
        const button = readFileSync(join(UI_DIR, 'Button.module.css'), 'utf8');
        expect(rule(button, '.md')).toMatch(/min-height:\s*var\(--xc-control-h-md,\s*40px\)/);
        expect(button).toMatch(
            /@media \(pointer:\s*coarse\)[\s\S]*?\.btn::after\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/,
        );
        expect(rule(bottomBar, '.sheetBody')).toMatch(/min-height:\s*0/);
        expect(rule(bottomBar, '.sheetBody')).toMatch(/flex:\s*1 1 auto/);
        expect(rule(bottomBar, '.sheetBody')).toMatch(/overflow-y:\s*auto/);
    });
});
