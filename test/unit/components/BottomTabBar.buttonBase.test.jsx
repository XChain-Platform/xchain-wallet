// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Bottom tabs stay native buttons for roving focus, so each one carries the
// shared Button base class in markup.

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import styles from '../../../packages/core/src/shared/components/BottomTabBar.module.css';

afterEach(() => cleanup());

const BASE = [buttonStyles.btn, buttonStyles.ghost, buttonStyles.md];

describe('BottomTabBar shared button base', () => {
    it('gives all five catalogue tabs the shared Button classes', () => {
        const { container } = render(
            <BottomTabBar
                currentView="home"
                onSelect={() => {}}
                onOpenSettings={() => {}}
            />,
        );

        const tabs = Array.from(container.querySelectorAll('button[data-bottom-tab]'));
        expect(tabs.map((tab) => tab.dataset.bottomTab)).toEqual([
            'home', 'send', 'receive', 'history', 'settings',
        ]);
        for (const tab of tabs) {
            expect(tab).toHaveClass(...BASE);
            expect(tab).toHaveClass(styles.tab);
        }
    });

    it('keeps the tab surface over the base hover fill without a composes', () => {
        const css = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/components/BottomTabBar.module.css'),
            'utf8',
        );
        expect(css).not.toMatch(/composes\s*:/);
        // The base hover and press rules outrank a single class.
        expect(css).toMatch(/\.tab\s*\{[^}]*--xc-button-hover-bg:\s*transparent/s);
        expect(css).toMatch(/\.tab:active:not\(:disabled\)\s*\{[^}]*filter:\s*none;[^}]*transform:\s*none;/s);

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
