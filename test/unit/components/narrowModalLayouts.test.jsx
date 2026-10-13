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
const ROUTE_DIR = join(process.cwd(), 'packages/core/src/shared/routes');
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
    it('keeps modal semantics in the shared overlay kit and specialized viewers', () => {
        expect([
            ...modalFiles(COMPONENT_DIR),
            ...modalFiles(UI_DIR),
        ].sort()).toEqual([
            'AlertsOverlay.jsx',
            'GatedFileViewer.jsx',
            'OverlaySurface.jsx',
        ]);
    });

    it('routes overlays through the shared surface and page-sized flows through page templates', () => {
        for (const name of [
            'BottomTabBar.jsx',
            'ConfirmModal.jsx',
            'HeaderSettingsButton.jsx',
            'NetworkStatusIndicator.jsx',
            'NoticeModal.jsx',
        ]) {
            expect(readFileSync(join(COMPONENT_DIR, name), 'utf8')).toContain('<OverlaySurface');
        }

        const confirmAction = readFileSync(join(COMPONENT_DIR, 'ConfirmActionModal.jsx'), 'utf8');
        expect(confirmAction).toContain('<Screen ');
        expect(confirmAction).toContain('<PageHeader');

        const addAddress = readFileSync(join(ROUTE_DIR, 'AddAddressModal.jsx'), 'utf8');
        expect(addAddress).toContain('<Screen ');
        expect(addAddress).toContain('<PageHeader');
        expect(addAddress).toContain('<FormPage');
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
        expect(dialog.firstElementChild).toHaveAttribute('data-overlay-surface', 'dialog');
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
        expect(dialog.firstElementChild).toHaveAttribute('data-overlay-surface', 'dialog');
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
        expect(sheet.firstElementChild).toHaveAttribute('data-overlay-surface', 'sheet');
        expect(sheet.firstElementChild).toContainElement(close);
        expect(close).toHaveClass(buttonStyles.md, buttonStyles.iconOnly);
        expect(sheet.lastElementChild).toContainElement(screen.getByRole('button', { name: 'Lock wallet' }));
        fireEvent.click(close);
        expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
    });
});

describe('320x568 modal layout contracts', () => {
    it('bounds centered dialogs and isolates their scrolling content', () => {
        const overlay = css('OverlaySurface.module.css');
        const surface = rule(overlay, '.surface');
        const dialog = rule(overlay, '.dialog');
        expect(surface).toMatch(/box-sizing:\s*border-box/);
        expect(surface).toMatch(/display:\s*flex/);
        expect(surface).toMatch(/flex-direction:\s*column/);
        expect(surface).toMatch(/overflow:\s*hidden/);
        expect(dialog).toMatch(/width:\s*100%/);
        expect(dialog).toMatch(/max-width:\s*20rem/);
        expect(dialog).toMatch(/max-height:\s*calc\(/);
        expect(rule(overlay, '.body')).toMatch(/min-height:\s*0/);
        expect(rule(overlay, '.body')).toMatch(/flex:\s*1 1 auto/);
        expect(rule(overlay, '.body')).toMatch(/overflow-y:\s*auto/);
        expect(rule(overlay, '.footer')).toMatch(/flex:\s*0 0 auto/);

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
        const overlay = css('OverlaySurface.module.css');
        const sheet = rule(overlay, '.sheet');
        expect(sheet).toMatch(/width:\s*100%/);
        expect(sheet).toMatch(/max-width:\s*35rem/);
        expect(sheet).toMatch(/max-height:\s*min\(70vh/);
        expect(rule(overlay, '.header')).toMatch(/flex:\s*0 0 auto/);
        const sheetClose = rule(overlay, '.close');
        expect(sheetClose).toMatch(/width:\s*var\(--xc-control-h-md\)/);
        expect(sheetClose).toMatch(/height:\s*var\(--xc-control-h-md\)/);
        expect(sheetClose).not.toMatch(/position:\s*absolute/);
        const button = readFileSync(join(UI_DIR, 'Button.module.css'), 'utf8');
        expect(rule(button, '.md')).toMatch(/min-height:\s*var\(--xc-control-h-md,\s*40px\)/);
        expect(button).toMatch(
            /@media \(pointer:\s*coarse\)[\s\S]*?\.btn::after\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/,
        );
        expect(rule(overlay, '.body')).toMatch(/min-height:\s*0/);
        expect(rule(overlay, '.body')).toMatch(/flex:\s*1 1 auto/);
        expect(rule(overlay, '.body')).toMatch(/overflow-y:\s*auto/);
    });
});
