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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';

const popupAppSource = readFileSync(
    join(process.cwd(), 'packages', 'extension', 'src', 'popup', 'App.jsx'),
    'utf8',
);
const bottomBarCss = readFileSync(
    join(process.cwd(), 'packages', 'core', 'src', 'shared', 'components', 'BottomTabBar.module.css'),
    'utf8',
);

function NavigationHarness({ initialView = 'home', onLock = () => {} }) {
    const [view, setView] = useState(initialView);
    return (
        <>
            <output data-testid="current-view">{view}</output>
            <BottomTabBar
                currentView={view}
                onSelect={setView}
                onLock={onLock}
                onOpenWalletPicker={() => setView('wallet-picker')}
                onOpenSettings={() => setView('settings')}
                hasVmAddress
                hasDexSurface
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
        expect(popupAppSource).toMatch(/onSelect=\{setUnlockedView\}/);
    });

    it.each([
        ['Receive', 'receive'],
        ['DEX', 'markets'],
        ['Dispensers', 'dispensers-list'],
        ['Contracts', 'contracts-list'],
        ['Messaging', 'messaging'],
        ['Contacts', 'contacts'],
        ['Lists', 'lists'],
        ['Payments due', 'obligations'],
        ['Switch wallet', 'wallet-picker'],
        ['Settings', 'settings'],
    ])('routes the More entry %s to %s', (label, expectedView) => {
        render(<NavigationHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(screen.getByTestId('current-view')).toHaveTextContent(expectedView);
    });

    it('labels and pads the More sheet consistently', () => {
        const onLock = vi.fn();
        render(<NavigationHarness onLock={onLock} />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        const sheet = screen.getByRole('dialog', { name: 'More' });
        expect(sheet).toContainElement(screen.getByRole('heading', { name: 'More', level: 2 }));
        expect(bottomBarCss).toMatch(
            /calc\(var\(--xc-space-3\) \+ env\(safe-area-inset-bottom, var\(--xc-space-3\)\)\)/,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Lock wallet' }));
        expect(onLock).toHaveBeenCalledOnce();
    });

    it('follows the current view in primary tabs and More destinations', () => {
        render(<NavigationHarness initialView="history" />);
        expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page');

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-current', 'page');

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('button', { name: 'Messaging' }));
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        expect(screen.getByRole('button', { name: 'Messaging' })).toHaveAttribute('aria-current', 'page');
    });
});
