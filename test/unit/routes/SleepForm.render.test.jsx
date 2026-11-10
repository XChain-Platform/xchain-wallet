// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('SleepForm rendering', () => {
    it('locks an address for the default one-day duration without indefinite controls', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            sleepState: vi.fn().mockResolvedValue(null),
            sleepAction: vi.fn().mockResolvedValue({ txid: 'sleep-txid' }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm walletId="wallet-1" mode="address" initialChainId={CHAIN} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('slider', { name: 'Duration' })).toHaveAttribute(
            'aria-valuetext',
            '1 day, 144 blocks',
        );
        expect(screen.queryByText(/Locking an address/)).toBeNull();
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByText(/Lock indefinitely/)).toBeNull();
        expect(await screen.findByText(/Ends at block 244/)).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Lock address' })).toBeEnabled());

        fireEvent.click(screen.getByRole('button', { name: 'Lock address' }));
        fireEvent.change(await screen.findByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Lock address' }));

        await waitFor(() => expect(messaging.sleepAction).toHaveBeenCalledWith(expect.objectContaining({
            params: { VERSION: '0', RESUME_BLOCK: '244' },
        })));
        expect(messaging.sleepAction.mock.calls[0][0].params.RESUME_BLOCK).not.toBe('-1');
    });

    it('renders an indefinite token pause and switches to resume mode', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getTokenInfo: vi.fn().mockResolvedValue({ tick: 'gate', creator: ADDRESS.address, locks: {} }),
            sleepState: vi.fn().mockResolvedValue({ resumeBlock: -1 }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm
                    walletId="wallet-1"
                    mode="tick"
                    initialChainId={CHAIN}
                    initialTick="gate"
                    onBack={vi.fn()}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('heading', { name: 'Pause token' })).toBeInTheDocument();
        expect(await screen.findByText('gate is currently PAUSED indefinitely.')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Resume now (unpause)' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Pause for a duration' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Pause indefinitely' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('radio', { name: 'Resume now (unpause)' }));

        expect(screen.getByRole('heading', { name: 'Resume token' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Resume token' })).toBeEnabled();
    });

    it('refuses a malformed token id before composing review', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getTokenInfo: vi.fn().mockResolvedValue(null),
            composeForConfirm: vi.fn(),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm
                    walletId="wallet-1"
                    mode="tick"
                    initialChainId={CHAIN}
                    initialTick="^abc"
                    onBack={vi.fn()}
                />
            </MessagingProvider>,
        );

        fireEvent.click(await screen.findByRole('radio', { name: 'Resume now (unpause)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Resume token' }));

        expect(await screen.findByText("Token can be a name, or ^ followed by the token's number (^123).")).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a token pause before review when the issuer is unknown', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getTokenInfo: vi.fn().mockResolvedValue({ tick: 'GATE', creator: null, locks: {} }),
            composeForConfirm: vi.fn(),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm walletId="wallet-1" mode="tick" initialChainId={CHAIN} initialTick="GATE" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        );
        expect(screen.getByRole('button', { name: 'Pause token' })).toBeDisabled();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
