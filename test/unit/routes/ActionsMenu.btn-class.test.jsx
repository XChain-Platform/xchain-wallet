// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The entry rows of the actions menu are the shared ActionList rows (G101,
// ruling 2026-11-13), the kit ListRow Settings draws, so they no longer carry
// the Button base or the .entry card. ActionsMenu.module.css still holds the
// old entry classes that Wallet Details borrows; that sheet keeps its card
// look through Card.module.css and never
// pulls the Button sheet in through composes, which would ship a second copy
// of it in the chunk and re-apply .btn over other buttons' overrides.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';
import rowStyles from '../../../packages/core/src/shared/routes/ActionsMenu.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

afterEach(() => cleanup());

const messaging = { getSettings: vi.fn(async () => ({ walletMode: 'full' })) };

function draw(node) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>{node}</MessagingProvider>,
    );
}

function menuItems(container) {
    return [...container.querySelectorAll('li > button')];
}

describe('menu entry rows are the shared ActionList rows', () => {
    it('draws every actions menu entry as an ActionList row, not a Button card', () => {
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
            // G101: the kit ListRow, not the Button base or the old card entry.
            expect([...item.classList]).not.toContain(buttonStyles.btn);
            expect([...item.classList]).not.toContain(rowStyles.entry);
            expect(item.hasAttribute('data-xc-menu-item')).toBe(false);
        }
        // G97: an entry that opens its page ends in the standard chevron; an
        // unavailable one opens nothing and carries none.
        const [issue, swap, destroy] = items;
        expect(issue.lastElementChild.getAttribute('aria-hidden')).toBe('true');
        expect(issue.lastElementChild.querySelector('svg')).toBeTruthy();
        expect(swap.lastElementChild.querySelector('svg')).toBeTruthy();
        expect(swap.textContent).toContain('Trade one token for another');
        expect(destroy.getAttribute('aria-disabled')).toBe('true');
        expect(destroy.textContent).toContain('Unavailable: No tokens to destroy');
        // The off row's only svg is its icon; no chevron.
        expect(destroy.querySelectorAll('svg')).toHaveLength(1);
    });

    it('drops the old card-grid list classes now the page draws ActionList cards', () => {
        const css = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/routes/ActionsMenu.module.css'),
            'utf8',
        );
        for (const name of ['listFull', 'listPopup', 'entryHead', 'entryReason']) {
            expect(css, name).not.toMatch(new RegExp(`\\.${name}\\b`));
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
