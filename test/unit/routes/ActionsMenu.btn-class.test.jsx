// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The entry rows of the actions menu and the main menu share one row style,
// ActionsMenu.module.css .entry. Every one of those rows carries the shared
// Button base class in its markup, so the layout harness reads it as a kit
// button and the press, focus and hidden states match every other button.
// The row stylesheet keeps its card look through Card.module.css and never
// pulls the Button sheet in through composes, which would ship a second copy
// of it in the chunk and re-apply .btn over other buttons' overrides.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';
import { MenuRoute } from '../../../packages/core/src/shared/routes/MenuRoute.jsx';
import rowStyles from '../../../packages/core/src/shared/routes/ActionsMenu.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

afterEach(() => cleanup());

const VARIANTS = ['primary', 'secondary', 'ghost', 'link', 'danger', 'success'];
const SIZES = ['sm', 'md', 'lg'];

const messaging = { getSettings: vi.fn(async () => ({ walletMode: 'full' })) };

function draw(node) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>{node}</MessagingProvider>,
    );
}

function menuItems(container) {
    expect(typeof buttonStyles.btn).toBe('string');
    expect(buttonStyles.btn.length).toBeGreaterThan(0);
    return [...container.querySelectorAll('[data-xc-menu-item]')];
}

describe('menu entry rows carry the shared Button base', () => {
    it('gives every actions menu entry the Button btn class', () => {
        const { container } = draw(
            <ActionsMenu
                onBack={() => {}}
                entries={[
                    { id: 'issue', label: 'Issue a token', onSelect: vi.fn() },
                    { id: 'swap', label: 'Swap', description: 'Trade one token for another', onSelect: vi.fn() },
                    { id: 'destroy', label: 'Destroy', disabled: true, disabledReason: 'No tokens to destroy' },
                ]}
            />,
        );
        const items = menuItems(container);
        expect(items).toHaveLength(3);
        for (const item of items) {
            expect(item.tagName).toBe('BUTTON');
            expect([...item.classList]).toContain(buttonStyles.btn);
            expect([...item.classList]).toContain(rowStyles.entry);
        }
    });

    it('gives every main menu row the Button btn class', () => {
        const { container } = draw(
            <MenuRoute
                onBack={() => {}}
                onMarkets={() => {}}
                onMoreActions={() => {}}
                onSwitchWallet={() => {}}
                onSettings={() => {}}
            />,
        );
        const items = menuItems(container);
        expect(items).toHaveLength(4);
        for (const item of items) {
            expect(item.tagName).toBe('BUTTON');
            expect(item.getAttribute('type')).toBe('button');
            const classes = [...item.classList];
            expect(classes).toContain(buttonStyles.btn);
            expect(classes).toContain(rowStyles.entry);
            // The kit rule: one variant and one size on every shared button.
            // The row paints no box of its own, so the variant is ghost.
            expect(VARIANTS.filter((v) => classes.includes(buttonStyles[v]))).toEqual(['ghost']);
            expect(SIZES.filter((s) => classes.includes(buttonStyles[s]))).toEqual(['md']);
        }
    });

    it('keeps the Button sheet out of the row stylesheet', () => {
        const css = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/routes/ActionsMenu.module.css'),
            'utf8',
        );
        const composes = css.split('\n').filter((line) => /\bcomposes\s*:/.test(line));
        expect(composes.filter((line) => /Button\.module\.css/.test(line))).toEqual([]);
        // The one composes the sheet carries is the shared card surface.
        expect(composes.every((line) => /from\s+['"]\.\.\/\.\.\/ui\/Card\.module\.css['"]/.test(line))).toBe(true);
    });
});
