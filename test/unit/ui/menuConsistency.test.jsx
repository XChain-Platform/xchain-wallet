// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';

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

    it('draws the action page as the shared ActionList rows (G101)', () => {
        render(withMessaging(
            <ActionsMenu
                onBack={() => {}}
                entries={[
                    { id: 'issue', label: 'Issue token', onSelect: () => {} },
                    { id: 'destroy', label: 'Destroy', onSelect: () => {} },
                ]}
            />,
        ));

        const issue = screen.getByRole('button', { name: /^Issue token/ });
        const destroy = screen.getByRole('button', { name: /^Destroy/ });
        expect(issue).not.toHaveAttribute('data-xc-menu-item');
        // A catalogue entry opens its form; it is never drawn as a danger row.
        expect(destroy).toHaveAttribute('data-tone', 'default');
        expect(destroy.closest('ul')).toHaveAttribute('role', 'list');
        expect(destroy.closest('ul')).not.toHaveAttribute('data-xc-menu-list');
    });
});
