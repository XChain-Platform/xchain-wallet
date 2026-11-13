// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ onSelect, onBack }) => (
        <section aria-label="Token picker">
            <button type="button" onClick={() => onSelect({ chainId: CHAIN, tick: 'GATE' })}>
                Choose GATE
            </button>
            <button type="button" onClick={onBack}>Back</button>
        </section>
    ),
}));

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
    resetWalletModes();
});

describe('SleepForm rendering', () => {
    it('starts an unlocked token pause with Network, From, and Token and refreshes token state', async () => {
        const litecoinChain = 'litecoin-mainnet';
        const litecoinAddress = {
            ...ADDRESS,
            id: 'address-2',
            address: 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9',
            derivationPath: "m/84'/2'/0'/0/0",
        };
        const getTokenInfo = vi.fn().mockResolvedValue({
            chainId: CHAIN,
            tick: 'GATE',
            creator: ADDRESS.address,
            locks: {},
        });
        const sleepState = vi.fn().mockResolvedValue(null);
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [ADDRESS],
                [litecoinChain]: [litecoinAddress],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getTokenInfo,
            sleepState,
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm walletId="wallet-1" mode="tick" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        // Network and the owner address live in the From section,
        // closed on load; open it to reach them.
        fireEvent.click(await screen.findByRole('button', { name: /^From/, expanded: false }));
        const network = await screen.findByRole('button', { name: 'Network: Bitcoin' });
        const from = screen.getByLabelText('From (token owner)');
        const token = screen.getByRole('button', { name: 'Token: Select a token' });
        expect(network.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(from.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('Active, not paused')).toBeInTheDocument(); // The state badge.
        expect(screen.getByText(
            "The token owner's address. Only the owner can pause or resume a token.",
        ).closest('[role="tooltip"]')).not.toBeNull();
        expect(screen.getByText(
            'Pausing a token rejects new XChain actions involving it. Already-open orders, swaps, and dispensers can still settle. The token owner can resume it early.',
        ).closest('[role="tooltip"]')).not.toBeNull();

        fireEvent.click(token);
        fireEvent.click(await screen.findByRole('button', { name: 'Choose GATE' }));

        expect(await screen.findByRole('button', { name: 'Token: GATE on Bitcoin' })).toBeInTheDocument();
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({
            chainId: CHAIN,
            tick: 'GATE',
            demo: false,
        }));
        await waitFor(() => expect(sleepState).toHaveBeenCalledWith({
            chainId: CHAIN,
            query: 'GATE',
            type: 'token',
        }));
        expect(await screen.findByText('Active, not paused')).toBeInTheDocument();

        // The Form Standard has the picked token decide the network,
        // so the Network field locks once a token is chosen.
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' })).toBeDisabled();
    });

    it('names the watcher action and explains the offline signer handoff', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN,
                tick: 'GATE',
                creator: ADDRESS.address,
                locks: {},
            }),
            sleepState: vi.fn().mockResolvedValue(null),
        };
        // A wallet's mode is published from the wallet list, not read from settings.
        publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode: 'watcher' }], activeWalletId: 'wallet-1' });

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm
                    walletId="wallet-1"
                    mode="tick"
                    initialChainId={CHAIN}
                    initialTick="GATE"
                    onBack={vi.fn()}
                />
            </MessagingProvider>,
        );

        const submit = await screen.findByRole('button', { name: /^Pause token$/i });
        await waitFor(() => expect(submit).toBeEnabled());
        expect(submit).toHaveAccessibleName(/^Pause token$/i);
        fireEvent.click(submit);

        expect(await screen.findByText(
            'Watcher mode: this prepares the transaction for your offline signer. Sign it there, then bring the signed transaction to a wallet that can broadcast it.',
        )).toBeInTheDocument();
    });

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

        // Network lives in the From section, closed on load.
        expect(await screen.findByRole('button', { name: 'About Network', hidden: true })).toBeInTheDocument();
        expect(await screen.findByRole('slider', { name: 'Duration' })).toHaveAttribute(
            'aria-valuetext',
            '1 day, 144 blocks',
        );
        expect(screen.queryByText(/Locking an address/)).toBeNull();
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByText(/Lock indefinitely/)).toBeNull();
        expect(await screen.findByText(/Ends at block 244/)).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: /^Lock address$/i })).toBeEnabled());

        fireEvent.click(screen.getByRole('button', { name: /^Lock address$/i }));
        fireEvent.change(await screen.findByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        // The signing submit is the green success action with the lock icon, never danger red.
        const reviewSubmit = screen.getByRole('button', { name: /^Lock address$/i });
        expect(reviewSubmit).toHaveTextContent('Lock Address');
        expect(reviewSubmit).toHaveClass(buttonStyles.success);
        expect(reviewSubmit).not.toHaveClass(buttonStyles.danger);
        expect(reviewSubmit.querySelector('svg')).not.toBeNull();
        fireEvent.click(reviewSubmit);

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

        // Page titles are Title Case.
        expect(await screen.findByRole('heading', { name: 'Pause Token' })).toBeInTheDocument();
        expect(await screen.findByText('Paused indefinitely')).toBeInTheDocument(); // The state badge.
        expect(screen.getByRole('radio', { name: 'Resume now (unpause)' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Pause for a duration' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Pause indefinitely' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('radio', { name: 'Resume now (unpause)' }));

        expect(screen.getByRole('heading', { name: 'Resume Token' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Resume token$/i })).toBeEnabled();
    });

    it('uses the Pause lock name when pausing and resuming are locked', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getTokenInfo: vi.fn().mockResolvedValue({
                tick: 'GATE', creator: ADDRESS.address, locks: { sleep: true },
            }),
            sleepState: vi.fn().mockResolvedValue(null),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm walletId="wallet-1" mode="tick" initialChainId={CHAIN} initialTick="GATE" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Pause and resume are permanently locked for GATE.',
        );
        expect(document.body).not.toHaveTextContent('Pausing and resuming are permanently locked');
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
        fireEvent.click(screen.getByRole('button', { name: /^Resume token$/i }));

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
        expect(screen.getByRole('button', { name: /^Pause token$/i })).toBeDisabled();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
