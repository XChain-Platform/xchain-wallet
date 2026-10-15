// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';
import { MenuRoute } from '../../../packages/core/src/shared/routes/MenuRoute.jsx';

const tokenCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

function withMessaging(node) {
    return (
        <MessagingProvider
            shell="web"
            messaging={{ getSettings: vi.fn(async () => ({ walletMode: 'full' })) }}
        >
            {node}
        </MessagingProvider>
    );
}

afterEach(() => cleanup());

describe('menu row contract', () => {
    it('uses one control-token height, icon size, and padding for menus and menu-like lists', () => {
        expect(tokenCss).toMatch(/--xc-menu-item-h:\s*var\(--xc-control-h-md\)/);
        expect(tokenCss).toMatch(/--xc-menu-item-icon:\s*var\(--xc-icon-md\)/);
        expect(tokenCss).toMatch(/--xc-menu-item-pad-block:\s*var\(--xc-space-2\)/);
        expect(tokenCss).toMatch(/--xc-menu-item-pad-inline:\s*var\(--xc-control-pad-x\)/);
        expect(tokenCss).toMatch(
            /\[role="menu"\] \[role="menuitem"\][\s\S]*?min-height:\s*var\(--xc-menu-item-h\)[\s\S]*?padding:\s*var\(--xc-menu-item-pad-block\) var\(--xc-menu-item-pad-inline\)/,
        );
        expect(tokenCss).toMatch(
            /\[data-xc-menu-list\] \[data-xc-menu-item\] svg[\s\S]*?width:\s*var\(--xc-menu-item-icon\)[\s\S]*?height:\s*var\(--xc-menu-item-icon\)/,
        );
        expect(tokenCss).toMatch(/\[data-xc-menu-list="rows"\] > li \+ li[\s\S]*?border-top:\s*1px solid var\(--xc-border\)/);
    });

    it('marks action pages and the header menu with the shared item semantics', () => {
        const view = render(withMessaging(
            <ActionsMenu
                onBack={() => {}}
                entries={[
                    { id: 'issue', label: 'Issue token', onSelect: () => {} },
                    { id: 'destroy', label: 'Destroy', onSelect: () => {} },
                ]}
            />,
        ));

        expect(screen.getByRole('button', { name: 'Issue token' })).toHaveAttribute('data-xc-menu-item');
        expect(screen.getByRole('button', { name: 'Destroy' })).toHaveAttribute('data-destructive', 'true');
        expect(screen.getByRole('button', { name: 'Destroy' }).closest('ul'))
            .toHaveAttribute('data-xc-menu-list', 'cards');

        view.rerender(withMessaging(
            <MenuRoute onBack={() => {}} onSettings={() => {}} />,
        ));
        const settings = screen.getByRole('button', { name: 'Settings' });
        expect(settings).toHaveAttribute('data-xc-menu-item');
        expect(settings.closest('ul')).toHaveAttribute('data-xc-menu-list', 'rows');
    });

    it('moves through the More sheet with arrows and restores focus on Escape', () => {
        render(
            <BottomTabBar
                currentView="home"
                onSelect={() => {}}
                onLock={() => {}}
                onOpenSettings={() => {}}
                onOpenWalletPicker={() => {}}
            />,
        );
        const more = screen.getByRole('button', { name: 'More' });
        fireEvent.click(more);

        const receive = screen.getByRole('button', { name: 'Receive' });
        receive.focus();
        fireEvent.keyDown(receive, { key: 'ArrowDown' });
        expect(screen.getByRole('button', { name: 'DEX' })).toHaveFocus();
        fireEvent.keyDown(document.activeElement, { key: 'End' });
        const lock = screen.getByRole('button', { name: 'Lock wallet' });
        expect(lock).toHaveFocus();
        expect(lock).toHaveAttribute('data-destructive', 'true');
        fireEvent.keyDown(lock, { key: 'Home' });
        expect(receive).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
        expect(more).toHaveFocus();
    });
});
