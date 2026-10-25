// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const OURS = 'bc1qwalletaddress000000000000000000000000001';

function entry(overrides = {}) {
    return {
        key: `${CHAIN}:42:${OURS}`,
        chainId: CHAIN,
        address: OURS,
        actionIndex: '42',
        action: 'SEND',
        blockIndex: 100,
        timestamp: 1705350600,
        txHash: 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899',
        source: OURS,
        raw: { source: OURS },
        link: null,
        detailContext: { chainTip: 110, indexerWatermark: 110, walletAddresses: [OURS] },
        ...overrides,
    };
}

function renderDetails(value) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ActionDetail entry={value} walletId="wallet" onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('ActionDetail with unusual rows', () => {
    it.each([
        ['an unknown action type', entry({ action: 'NOT_A_REAL_ACTION' })],
        ['an empty action type', entry({ action: '' })],
        ['a missing action type', entry({ action: undefined })],
        ['a missing raw payload', entry({ raw: undefined })],
        ['a null raw payload', entry({ raw: null })],
        ['a missing timestamp and hash', entry({ timestamp: undefined, txHash: undefined })],
        ['a missing detail context', entry({ detailContext: undefined })],
        ['a non-numeric action index', entry({ actionIndex: 'abc' })],
        ['a huge action index', entry({ actionIndex: '9'.repeat(400) })],
        ['an unknown chain', entry({ chainId: 'no-such-chain' })],
        ['a string block index', entry({ blockIndex: 'NaN' })],
    ])('renders %s without throwing', (_name, value) => {
        renderDetails(value);
        expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    });

    it('renders a one megabyte memo and payload', () => {
        const big = 'x'.repeat(1_000_000);
        const started = Date.now();
        renderDetails(entry({ raw: { source: OURS, destination: OURS, memo: big, description: big, extra: { a: big } } }));
        expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
        expect(Date.now() - started).toBeLessThan(5000);
    });
});
