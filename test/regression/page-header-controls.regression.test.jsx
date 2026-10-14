// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Regression suite: page header controls.
//
//   [P1] 2026-10-13: Page header controls share the medium icon-only kit
//        button contract so their footprints and centred icons stay aligned.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../packages/core/src/shared/routes/History.jsx';
import buttonStyles from '../../packages/core/src/ui/Button.module.css';

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
    it('[REGRESSION P1] aligns the History back and refresh controls with the same medium icon button classes', () => {
        renderHistory();

        const back = screen.getByRole('button', { name: 'Back to home' });
        const refresh = screen.getByRole('button', { name: 'Refresh history' });

        expect(back).toHaveClass(buttonStyles.btn, buttonStyles.md, buttonStyles.iconOnly);
        expect(refresh).toHaveClass(buttonStyles.btn, buttonStyles.md, buttonStyles.iconOnly);
        expect(refresh.className).toBe(back.className);
    });

    it('[REGRESSION P1] renders History Refresh as one icon child without a label span', () => {
        renderHistory();

        const refresh = screen.getByRole('button', { name: 'Refresh history' });

        expect(refresh.children).toHaveLength(1);
        expect(refresh.querySelector(`.${buttonStyles.label}`)).toBeNull();
    });
});
