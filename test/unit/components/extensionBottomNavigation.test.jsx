// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';

const popupAppSource = readFileSync(
    join(process.cwd(), 'packages', 'extension', 'src', 'popup', 'App.jsx'),
    'utf8',
);
function NavigationHarness({ initialView = 'home' }) {
    const [view, setView] = useState(initialView);
    return (
        <>
            <output data-testid="current-view">{view}</output>
            <BottomTabBar
                currentView={view}
                onSelect={setView}
                onOpenSettings={() => setView('settings')}
            />
        </>
    );
}

afterEach(() => cleanup());

describe('extension bottom navigation', () => {
    it('mounts the shared bottom bar in the extension compact layout', () => {
        expect(popupAppSource).toMatch(
            /import \{ BottomTabBar \} from '@xchain-wallet\/core\/shared\/components\/BottomTabBar\.jsx'/,
        );
        expect(popupAppSource).toMatch(
            /<FullLayoutWithNav[\s\S]*?bottomBar=\{\([\s\S]*?<BottomTabBar/,
        );
        expect(popupAppSource).toMatch(/currentView=\{unlockedView\}/);
        expect(popupAppSource).toMatch(/onSelect=\{handleWalletMenuSelect\}/);
    });

    it.each([
        ['Home', 'home'],
        ['Send', 'send'],
        ['Receive', 'receive'],
        ['History', 'history'],
        ['Settings', 'settings'],
    ])('routes the %s tab to %s', (label, expectedView) => {
        render(<NavigationHarness />);
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(screen.getByTestId('current-view')).toHaveTextContent(expectedView);
    });

    it('follows the current view across all five tabs', () => {
        render(<NavigationHarness initialView="history" />);
        expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page');

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-current', 'page');

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    });

    it.each(['contacts', 'account-picker'])(
        'leaves the bar tabs unmarked for the %s destination',
        (initialView) => {
            render(<NavigationHarness initialView={initialView} />);
            expect(screen.getByRole('button', { name: 'Home' }))
                .not.toHaveAttribute('aria-current');
        },
    );
});
