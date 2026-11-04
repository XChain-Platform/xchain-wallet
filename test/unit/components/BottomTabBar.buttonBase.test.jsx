// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bottom tab bar and its More sheet stay native buttons for roving focus
// and full-row menu semantics, so each one carries the shared Button base
// class in markup. A CSS composes would inline a second Button sheet into the
// bar's chunk and re-apply .btn over the tab rules.

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { preloadOnDemandOverlays } from '../../../packages/core/src/shared/components/onDemandOverlays.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import styles from '../../../packages/core/src/shared/components/BottomTabBar.module.css';

// The app loads the sheet surface on idle after first paint; load it up front.
beforeAll(() => preloadOnDemandOverlays());

afterEach(() => cleanup());

const BASE = [buttonStyles.btn, buttonStyles.ghost, buttonStyles.md];

describe('BottomTabBar shared button base', () => {
    it('gives every tab and every More sheet row the shared Button classes', () => {
        const { container } = render(
            <BottomTabBar
                currentView="home"
                onSelect={() => {}}
                onLock={vi.fn()}
                onOpenSettings={vi.fn()}
                onOpenWalletPicker={vi.fn()}
                onCommandPalette={vi.fn()}
            />,
        );

        const tabs = Array.from(container.querySelectorAll('button[data-bottom-tab]'));
        expect(tabs.length).toBeGreaterThanOrEqual(5);
        for (const tab of tabs) {
            expect(tab).toHaveClass(...BASE);
            expect(tab).toHaveClass(styles.tab);
        }

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        const dialog = screen.getByRole('dialog', { name: 'More' });
        const rows = Array.from(dialog.querySelectorAll('button[data-xc-menu-item]'));
        // The nav rows plus Search, Switch wallet, Settings and Lock.
        expect(rows.length).toBeGreaterThanOrEqual(8);
        for (const row of rows) {
            expect(row).toHaveClass(...BASE);
            expect(row).toHaveClass(styles.sheetItem);
        }
    });

    it('keeps the tab and row surfaces over the base hover fill without a composes', () => {
        const css = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/components/BottomTabBar.module.css'),
            'utf8',
        );
        expect(css).not.toMatch(/composes\s*:/);
        // The base hover and press rules outrank a single class, so each surface
        // names the fill they paint: none on a tab, the surface tone on a row.
        expect(css).toMatch(/\.tab\s*\{[^}]*--xc-button-hover-bg:\s*transparent/s);
        expect(css).toMatch(/\.sheetItem\s*\{[^}]*--xc-button-hover-bg:\s*var\(--xc-surface\)/s);
        expect(css).toMatch(
            /\.tab:active:not\(:disabled\),\s*\.sheetItem:active:not\(:disabled\)\s*\{[^}]*filter:\s*none;[^}]*transform:\s*none;/s,
        );

        const jsx = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/components/BottomTabBar.jsx'),
            'utf8',
        );
        // The Button sheet loads ahead of the bar's own sheet, so the tab rules follow it.
        expect(jsx.indexOf("from '../../ui/Button.module.css'"))
            .toBeLessThan(jsx.indexOf("from './BottomTabBar.module.css'"));
        expect(jsx.indexOf("from '../../ui/Button.module.css'")).toBeGreaterThan(-1);
    });
});
