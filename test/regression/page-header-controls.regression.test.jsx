// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Regression suite: page header controls.
//
//   [P1] 2026-10-13: Page header controls share one medium footprint so
//        their boxes and centred icons stay aligned on both edges.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
    it('[REGRESSION P1] aligns the History back and refresh controls on one medium footprint', () => {
        renderHistory();

        const back = screen.getByRole('button', { name: 'Back to home' });
        const refresh = screen.getByRole('button', { name: 'Refresh history' });

        // 21b makes the back control the kit small secondary Button; the
        // trailing slot keeps the medium header side footprint.
        expect(back).toHaveClass(buttonStyles.btn, buttonStyles.sm, buttonStyles.iconOnly);
        expect(refresh.closest(`.${pageHeaderStyles.trailing}`)).not.toBeNull();
        expect(refresh).toHaveClass(buttonStyles.btn, buttonStyles.md, buttonStyles.iconOnly);
        for (const body of [ruleBody('.trailing button:not([role="menuitem"])')]) {
            expect(body).toMatch(/width:\s*var\(--xc-page-header-side\)/);
            expect(body).toMatch(/height:\s*var\(--xc-page-header-side\)/);
            expect(body).toMatch(/justify-content:\s*center/);
        }
        expect(pageHeaderCss).toMatch(/--xc-page-header-side:\s*var\(--xc-control-h-md\)/);
    });

    it('[REGRESSION P1] renders History Refresh as one icon child without a label span', () => {
        renderHistory();

        const refresh = screen.getByRole('button', { name: 'Refresh history' });

        expect(refresh.children).toHaveLength(1);
        expect(refresh.querySelector(`.${buttonStyles.label}`)).toBeNull();
    });
});
