// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const OWNER = 'bcrt1qownerownerownerownerownerowner000';
const HOLDER = 'bcrt1qholderholderholderholderholder0000';

beforeEach(() => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
    });
});
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function mount({ holders, rejectHolders = null, omitHolders = false, tokenInfo = {}, props = {}, messagingOverrides = {} } = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({ creator: OWNER, divisibility: 8, ...tokenInfo }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OWNER }] }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getHistoryForToken: vi.fn().mockResolvedValue({ data: [] }),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [] }),
        ...messagingOverrides,
    };
    if (!omitHolders) {
        messaging.getHoldersForToken = rejectHolders
            ? vi.fn().mockRejectedValue(rejectHolders)
            : vi.fn().mockResolvedValue(holders ?? { data: [] });
    }
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ManageToken walletId="wallet" chainId={CHAIN} tick="MANAGEPROBE" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    return messaging;
}

describe('ManageToken holders', () => {
    it.each([
        ['locked', true, 'Locked supply'],
        ['unlocked', false, 'Unlocked supply'],
    ])('labels and formats %s supply', async (_state, locked, label) => {
        mount({ tokenInfo: {
            locked,
            totalSupply: '12345678901234567890.30000000000000004',
            maxSupply: '99999999999999999999',
        } });

        expect(await screen.findByText(label)).toBeTruthy();
        expect(screen.getByText('12,345,678,901,234,567,890.3')).toBeTruthy();
        expect(screen.getByText('of 99,999,999,999,999,999,999 cap')).toBeTruthy();
    });

    it('renders real and demo holder shapes with the right units and copy values', async () => {
        mount({ holders: { data: [
            { address: HOLDER, amount: '12345.5' },
            { address: `${HOLDER}2`, quantity: '125000000' },
        ] } });
        fireEvent.click(screen.getByRole('tab', { name: 'Holders' }));

        expect(await screen.findByText('12,345.5')).toBeTruthy();
        expect(screen.getByText('1.25000000')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Copy holder address 1' }));
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(HOLDER));
    });

    it.each([
        ['failed request', { rejectHolders: new Error('explorer offline') }, /couldn't load the holders/i],
        ['missing host method', { omitHolders: true }, /holders lookup is not available/i],
    ])('shows a load error for a %s', async (_label, options, message) => {
        mount(options);
        fireEvent.click(screen.getByRole('tab', { name: 'Holders' }));

        expect(await screen.findByText(message)).toBeTruthy();
        expect(screen.queryByText(/No holders yet/)).toBeNull();
    });

    it('shows the holder empty state after a successful empty response', async () => {
        mount();
        fireEvent.click(screen.getByRole('tab', { name: 'Holders' }));
        expect(await screen.findByText(/No holders yet/)).toBeTruthy();
    });

    it('copies the complete owner address', async () => {
        mount();
        const copy = await screen.findByRole('button', { name: 'Copy owner address' });
        fireEvent.click(copy);
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(OWNER));
    });

    it('shows a disabled action reason without relying on hover', async () => {
        mount({
            tokenInfo: { lockBridge: true },
            props: { onBridgeSettings: vi.fn() },
        });

        const bridge = await screen.findByRole('button', {
            name: 'Bridge: Bridge settings are frozen for this token and can never change.',
        });
        expect(bridge).toBeDisabled();
        expect(bridge).not.toHaveAttribute('title');
    });

    it('shows the complete paused state without relying on hover', async () => {
        mount({ messagingOverrides: {
            sleepState: vi.fn().mockResolvedValue({ resumeBlock: 900 }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 800 }),
        } });

        expect(await screen.findByText('Paused until block 900')).toBeInTheDocument();
        expect(screen.queryByTitle('Paused until block 900')).toBeNull();
    });
});
