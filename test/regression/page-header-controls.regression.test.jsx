// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Regression suite: page header controls.
//
//   [P1] 2026-10-13: Page header controls share one footprint so their
//        boxes and centred icons stay aligned on both edges.
//   [P1] 2026-10-14: That footprint is the Back control's small size, so a
//        screen with a trailing action is no taller than one without.
//   [P1] 2026-10-15: The page header holds only the title and Back. History's
//        Refresh left it for the content actions row, as a labelled button.
//        Superseded 2026-11-11 and 2026-11-13 (G02, G95): the title line
//        carries page-level outlined icon buttons and nothing sits between
//        the header and the list. Since 2026-11-13 Refresh sits in the
//        title line's ⋯ icon button menu, beside Export, right of the filter.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../packages/core/src/shared/routes/History.jsx';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import buttonStyles from '../../packages/core/src/ui/Button.module.css';
import pageHeaderStyles from '../../packages/core/src/ui/PageHeader.module.css';

const pageHeaderCss = readFileSync(
    join(process.cwd(), 'packages', 'core', 'src', 'ui', 'PageHeader.module.css'),
    'utf8',
);

function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return pageHeaderCss.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

function renderHistory() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="wallet-a" accountId="account-a" onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('regression/page-header-controls', () => {
    it('[REGRESSION P1] keeps the page header trailing footprint on the Back control size', () => {
        renderHistory();

        // Back names no page: it returns wherever History was opened from (G06).
        const back = screen.getByRole('button', { name: 'Back to previous screen' });

        // Back is the kit small Button; the trailing actions are the app bar's
        // 44px outlined buttons, and every header row holds the same 44px
        // height with or without Back or a trailing action, so a screen with
        // an action is no taller than one without.
        expect(back).toHaveClass(buttonStyles.btn, buttonStyles.sm, buttonStyles.iconOnly);
        const trailing = ruleBody('.trailing button:not([role="menuitem"], [role="dialog"] *)');
        expect(trailing).toMatch(/width:\s*var\(--xc-control-h-md\)/);
        expect(trailing).toMatch(/height:\s*var\(--xc-control-h-md\)/);
        expect(trailing).toMatch(/justify-content:\s*center/);
        expect(ruleBody('.header.header')).toMatch(/min-height:\s*var\(--xc-control-h-md\)/);
        expect(pageHeaderCss).toMatch(/--xc-control-h-md:\s*44px/);
        expect(pageHeaderCss).toMatch(/--xc-page-header-side:\s*var\(--xc-control-h-md\)/);
    });

    it('[REGRESSION P1] renders History Refresh in a title-line ⋯ icon button menu, with no actions row above the list (G02, G95)', () => {
        renderHistory();

        // No separate Refresh button: the title line's ⋯ icon button holds it.
        expect(screen.queryByRole('button', { name: 'Refresh history' })).toBeNull();
        const more = screen.getByRole('button', { name: 'More actions' });

        expect(more.closest(`.${pageHeaderStyles.trailing}`)).not.toBeNull();
        expect(document.querySelector('[data-xc-page-actions]')).toBeNull();
        expect(more).toHaveClass(buttonStyles.btn, buttonStyles.md, buttonStyles.iconOnly);
        expect(more.querySelector('svg')).toBeTruthy();

        fireEvent.click(more);
        const refresh = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Refresh history' });
        expect(refresh.closest(`.${pageHeaderStyles.trailing}`)).not.toBeNull();
        expect(refresh.querySelector('svg')).toBeTruthy();
    });
});
