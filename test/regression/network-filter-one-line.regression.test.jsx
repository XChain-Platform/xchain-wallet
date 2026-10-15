// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: compact network filters.
//
//   [P1] 2026-10-13: A visible network count forms a second line and clips
//        the Contacts and Dispensers filter trigger in a 411px toolbar.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NetworkFilterDropdown } from '../../packages/core/src/shared/components/NetworkFilterDropdown.jsx';
import dropdownStyles from '../../packages/core/src/shared/components/NetworkFilterDropdown.module.css';
import filterStyles from '../../packages/core/src/shared/components/NetworkFilter.module.css';

const VIEWPORT_WIDTH = 411;
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const filterCss = readFileSync(resolve(
    process.cwd(),
    'packages/core/src/shared/components/NetworkFilter.module.css',
), 'utf8');

const surfaces = [
    {
        name: 'Contacts',
        source: 'packages/core/src/shared/routes/ContactsList.jsx',
    },
    {
        name: 'Dispensers',
        source: 'packages/core/src/shared/routes/DispensersList.jsx',
    },
];

afterEach(() => {
    cleanup();
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    else delete window.innerWidth;
});

describe('regression/network-filter-one-line', () => {
    it.each(surfaces)(
        '[REGRESSION P1] keeps the $name network filter to one line at 411px',
        ({ name, source }) => {
            Object.defineProperty(window, 'innerWidth', {
                configurable: true,
                value: VIEWPORT_WIDTH,
            });
            const routeSource = readFileSync(resolve(process.cwd(), source), 'utf8');

            render(
                <div aria-label={`${name} toolbar`} style={{ width: VIEWPORT_WIDTH }}>
                    <NetworkFilterDropdown
                        value="all"
                        onChange={() => {}}
                        announceNetworkCount
                    />
                </div>,
            );

            const trigger = screen.getByRole('button', {
                name: 'Filter by network: All networks, 3 networks',
            });
            const dropdown = trigger.closest(`.${dropdownStyles.networkWrap}`);
            const filter = trigger.closest(`.${filterStyles.wrap}`);
            const icon = trigger.querySelector(`.${filterStyles.triggerIcon}`);
            const label = trigger.querySelector(`.${filterStyles.triggerLabel}`);
            const labelRule = filterCss.match(/\.triggerLabel\s*\{[^}]*\}/)?.[0] || '';

            expect(window.innerWidth).toBe(VIEWPORT_WIDTH);
            expect(routeSource).toMatch(
                /<NetworkFilterDropdown\b[^>]*\bannounceNetworkCount\b[^>]*\/>/,
            );
            expect(dropdown).toHaveClass(dropdownStyles.md);
            expect(filter).toHaveClass(filterStyles.md);
            expect(icon).toBeInTheDocument();
            expect(label).toHaveTextContent('All networks');
            expect(trigger).not.toHaveTextContent('3 networks');
            expect(labelRule).toMatch(/overflow:\s*hidden/);
            expect(labelRule).toMatch(/text-overflow:\s*ellipsis/);
            expect(labelRule).toMatch(/white-space:\s*nowrap/);
        },
    );
});
