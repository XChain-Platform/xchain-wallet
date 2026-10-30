// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home prints an amount on its Sweep and Issue rows; History printed only the
// ticker. Both now format the record's base-unit amount with the same helper.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { activityRowAmount, formatBaseUnits } from '../../../packages/core/src/shared/utils/activityAmount.js';

const CHAIN = 'bitcoin-regtest';
const WALLET = 'demo-wallet-sweep-issue';

function rowText(label) {
    const row = [...document.querySelectorAll('button[data-history-row]')]
        .find((node) => node.textContent.includes(label));
    return row ? row.textContent : null;
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    window.localStorage.clear();
});

describe('activityRowAmount', () => {
    it('reads base units for non-SEND actions and whole units for SEND', () => {
        expect(formatBaseUnits('2500000', 8)).toBe('0.025');
        expect(activityRowAmount({ action: 'SWEEP', raw: { amount: '2500000' } }, { divisibility: 8 })).toBe('0.025');
        expect(activityRowAmount({ action: 'SEND', raw: { amount: '100' } }, { divisibility: 8 })).toBe('100');
        expect(activityRowAmount({ action: 'SWEEP', raw: {} }, { divisibility: 8 })).toBe('');
    });
});

describe('History sweep and issue amounts', () => {
    it('prints the amount beside the ticker on Sweep and Issue rows', async () => {
        markDemoWallet(WALLET);
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: 'demo-address' }] }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            getSettings: vi.fn().mockResolvedValue({}),
            listContacts: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <History walletId={WALLET} accountId="demo-account" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(rowText('Sweep')).toBeTruthy());
        expect(rowText('Sweep')).toContain('0.025 BTC');
        await waitFor(() => expect(rowText('Issue')).toBeTruthy());
        expect(rowText('Issue')).toContain('1 DEMOCOIN');
    });
});
