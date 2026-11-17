// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The unified wallet menu contains catalogue and footer rows only. Sibling
// platform sites never appear as rows or links.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import { visibleWalletMenu } from '../../../packages/core/src/shared/walletMenu.js';

// The xchain.io site links the wallet menu once carried; none belong in it.
const SITE_LINK_LABELS = [
    'Main site', 'Explorer', 'Documentation', 'Encoder status',
    'Bootstraps & sync', 'Bootstraps and sync', 'Validator hub', 'MCP for agents',
];

afterEach(() => cleanup());

describe('the unified wallet menu holds only wallet items', () => {
    it('renders exactly the visible catalogue rows, no footer rows and no lock row, with no site links', () => {
        const gates = {
            hasDexSurface: true,
            hasVmAddress: true,
            hasBtcAddress: true,
        };
        const { container } = render(
            <CommandPalette
                open
                onClose={() => {}}
                commands={[]}
                menu={{
                    gates,
                    currentView: 'home',
                    onSelect: () => {},
                    onOpenSettings: () => {},
                    onLock: () => {},
                }}
            />,
        );
        const expectedIds = [
            ...visibleWalletMenu(gates).flatMap((group) => group.rows.map((row) => row.id)),
        ];
        const rows = Array.from(container.querySelectorAll('[data-wallet-menu-row]'));

        expect(rows.map((row) => row.getAttribute('data-wallet-menu-row'))).toEqual(expectedIds);
        expect(container.querySelectorAll('a[href]')).toHaveLength(0);
        for (const label of SITE_LINK_LABELS) {
            expect(screen.queryByText(label, { exact: true }), label).toBeNull();
        }
    });
});
