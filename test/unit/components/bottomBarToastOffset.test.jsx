// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The toast stack pinned 16px from the bottom of the screen, so on a phone
// "Address copied to clipboard." sat on top of the bottom tab bar and hid it
// (LG K51, 2026-10-12). The bar now publishes its height while mounted and
// the toast stack sits above it.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup } from '@testing-library/react';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';

const barHeight = () => document.documentElement.style.getPropertyValue('--xc-bottom-bar-h');

afterEach(() => cleanup());

describe('bottom tab bar footprint', () => {
    it('is published while the bar is mounted and cleared when it unmounts', () => {
        expect(barHeight()).toBe('');
        const view = render(<BottomTabBar currentView="home" onSelect={() => {}} />);
        expect(barHeight()).toBe('3.5rem');
        view.unmount();
        expect(barHeight()).toBe('');
    });

    it('is what the toast stack offsets itself by', () => {
        const css = readFileSync(
            join(process.cwd(), 'packages', 'core', 'src', 'shared', 'components', 'ToastHost.module.css'),
            'utf8',
        );
        expect(css).toMatch(
            /bottom:\s*calc\([\s\S]*?var\(--xc-space-4\)[\s\S]*?\+\s*var\(--xc-bottom-bar-h,\s*0px\)[\s\S]*?\+\s*env\(safe-area-inset-bottom,\s*0px\)[\s\S]*?\)/,
        );
    });

    it('moves above an overlay keyboard while the fitted viewport is active', () => {
        const css = readFileSync(
            join(process.cwd(), 'packages', 'core', 'src', 'shared', 'components', 'ToastHost.module.css'),
            'utf8',
        );
        expect(css).toMatch(/html\[data-xc-keyboard='open'\][\s\S]*?100vh\s*-\s*var\(--xc-viewport-h/);
    });
});
