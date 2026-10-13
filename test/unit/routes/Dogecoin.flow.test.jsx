// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const { qrToDataURL } = vi.hoisted(() => ({
    qrToDataURL: vi.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgo='),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: qrToDataURL },
}));

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useFiatRate: () => ({ rate: null, fiatCurrency: 'USD' }),
    useTickFiatRate: () => null,
}));

const { Receive } = await import('../../../packages/core/src/shared/routes/Receive.jsx');
const { Send } = await import('../../../packages/core/src/shared/routes/Send.jsx');
const { MintForm } = await import('../../../packages/core/src/shared/routes/MintForm.jsx');
const { History } = await import('../../../packages/core/src/shared/routes/History.jsx');

const CHAIN_ID = 'dogecoin-mainnet';
const WALLET_ID = 'doge-flow-wallet';
const OUR_ADDRESS = 'D8FaQQWt8SJCiCGYYBAsUn8qhXxthiYBro';
const OTHER_ADDRESS = 'D6hLULEGDRbk86j58t5iWmeinqM6acA16V';
const PSBT = '70736274ff';

const ADDRESS = Object.freeze({
    id: 'doge-address-1',
    address: OUR_ADDRESS,
    addressType: 'p2pkh',
    publicKey: '02ab',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
});

function provider(messaging, child) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>{child}</ToastHost>
        </MessagingProvider>
    );
}

function permissiveMessaging(methods) {
    return new Proxy(methods, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
}

function dogeSettings() {
    return {
        walletMode: 'full',
        activeNetwork: 'mainnet',
        lastUsedChainId: CHAIN_ID,
        grace: { testSendThresholdSats: 0 },
        privacy: { formDraftTtlMs: 0, priceDataEnabled: false },
        fees: { [CHAIN_ID]: { strategy: 'normal', rbfByDefault: true } },
    };
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    qrToDataURL.mockClear();
    localStorage.clear();
});

describe('Dogecoin route flow with mocked SDK messaging', () => {
    it('builds a Dogecoin receive request from the persisted P2PKH address', async () => {
        const messaging = permissiveMessaging({
            getSettings: vi.fn().mockResolvedValue(dogeSettings()),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [ADDRESS] }),
            getNewestAddress: vi.fn().mockResolvedValue(ADDRESS),
            estimateFee: vi.fn().mockResolvedValue({
                unit: 'DOGE/kB',
                minimumRate: 100_000,
                low: { rate: 100_000, etaMinutes: 2 },
                normal: { rate: 100_000, etaMinutes: 1 },
                fast: { rate: 200_000, etaMinutes: 1 },
            }),
        });

        render(provider(
            messaging,
            <Receive walletId={WALLET_ID} prefill={{ chainId: CHAIN_ID, tick: 'DOGE' }} />,
        ));

        expect(await screen.findByText(OUR_ADDRESS)).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Amount (DOGE)' })).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', { name: 'Amount (DOGE)' }), {
            target: { value: '12.5' },
        });

        await waitFor(() => expect(qrToDataURL).toHaveBeenLastCalledWith(
            `dogecoin:${OUR_ADDRESS}?chain=dogecoin-mainnet&amount=12.5`,
            expect.objectContaining({ margin: 4 }),
        ));
        expect(messaging.getNewestAddress).toHaveBeenCalledWith(
            WALLET_ID,
            CHAIN_ID,
            undefined,
        );
    });

    it('enforces the DOGE output floor and composes at the DOGE fee rate without RBF', async () => {
        const composeForConfirm = vi.fn().mockResolvedValue({
            psbt: PSBT,
            encoding: 'psbt',
            actionString: `SEND|1|DOGE|0.001|${OTHER_ADDRESS}`,
            version: 1,
            chainId: CHAIN_ID,
            networkFeeSats: 25_000_000,
            bareNativePayment: true,
            decoded: {
                summary: 'Send 0.001 DOGE',
                details: [
                    { label: 'Token', value: 'DOGE' },
                    { label: 'Amount', value: '0.001' },
                    { label: 'Destination', value: OTHER_ADDRESS },
                ],
                warnings: [],
            },
        });
        const messaging = permissiveMessaging({
            getSettings: vi.fn().mockResolvedValue(dogeSettings()),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: ADDRESS }),
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'DOGE', quantity: '500000000000', divisibility: 8 },
                tokens: [],
            }),
            estimateFee: vi.fn().mockResolvedValue({
                unit: 'DOGE/kB',
                minimumRate: 100_000,
                low: { rate: 100_000, etaMinutes: 2 },
                normal: { rate: 100_000, etaMinutes: 1 },
                fast: { rate: 200_000, etaMinutes: 1 },
            }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
            listContacts: vi.fn().mockResolvedValue([]),
            getRecentDestinations: vi.fn().mockResolvedValue([]),
            getAddressHistory: vi.fn().mockResolvedValue([]),
            gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
            composeForConfirm,
        });

        render(provider(messaging, <Send walletId={WALLET_ID} onBack={() => {}} />));

        fireEvent.change(await screen.findByLabelText(/^To$/), {
            target: { value: OTHER_ADDRESS },
        });
        const amount = screen.getByLabelText(/^Amount \(DOGE\)/);
        fireEvent.change(amount, { target: { value: '0.00099999' } });
        expect(await screen.findByText(/smallest DOGE payment.*0\.001 DOGE/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(amount, { target: { value: '0.001' } });
        await waitFor(() => expect(screen.queryByText(/too small to send/i)).toBeNull());
        expect(screen.queryByRole('switch', { name: /fee bumping/i })).toBeNull();
        expect(screen.getByRole('slider', { name: 'Network fee' }))
            .toHaveAttribute('aria-valuetext', expect.stringContaining('0.25'));

        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN_ID,
            amount: '0.001',
            tick: 'DOGE',
            feePerKb: 100_000_000,
            rbf: false,
        })));
        expect(await screen.findByTestId('confirm-fee')).toHaveTextContent('0.25 DOGE');
    });

    it('shows and preserves the mandatory DOGE protocol-fee output for a mint', async () => {
        const composeForConfirm = vi.fn().mockResolvedValue({
            psbt: PSBT,
            encoding: 'psbt',
            actionString: 'MINT|0|BARK|10',
            version: 0,
            chainId: CHAIN_ID,
            networkFeeSats: 25_000_000,
            quote: {
                requiredFeeSats: 100_000,
                requiredFeeNative: '0.00100000',
                feeDestination: OTHER_ADDRESS,
            },
            decoded: {
                summary: 'Mint 10 BARK',
                details: [
                    { label: 'Token', value: 'BARK' },
                    { label: 'Amount', value: '10' },
                ],
                warnings: [],
            },
            simulation: { deltas: [{ tick: 'BARK', before: '0', after: '10' }] },
        });
        const mintToken = vi.fn().mockResolvedValue({ txid: 'doge-mint-txid' });
        const messaging = permissiveMessaging({
            getSettings: vi.fn().mockResolvedValue(dogeSettings()),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: ADDRESS }),
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN_ID,
                tick: 'BARK',
                totalSupply: '100',
                maxSupply: '1000',
                divisibility: 0,
                locks: {},
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            listContacts: vi.fn().mockResolvedValue([]),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
            composeForConfirm,
            preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
            mintToken,
        });

        render(provider(
            messaging,
            <MintForm
                walletId={WALLET_ID}
                initialChainId={CHAIN_ID}
                initialTick="BARK"
                onBack={() => {}}
            />,
        ));

        expect(await screen.findByText('Protocol fees are paid in DOGE')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: /^Mint$/ }));

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN_ID,
            encoderOpts: {
                payFeeInNativeCoin: true,
                feePerKb: 100_000_000,
            },
        })));
        expect(await screen.findByTestId('confirm-native-protocol-fee'))
            .toHaveTextContent('Protocol fee: 0.001 DOGE');

        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
        fireEvent.click(screen.getByTestId('confirm-approve'));
        await waitFor(() => expect(mintToken).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN_ID,
            payFeeInNativeCoin: true,
            feePerKb: 100_000_000,
            prebuiltPsbt: expect.objectContaining({ psbtHex: PSBT }),
        })));
    });

    it('renders a settled outgoing DOGE payment from SDK history', async () => {
        const messaging = permissiveMessaging({
            getSettings: vi.fn().mockResolvedValue({ showFiatInHistory: false }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [ADDRESS] }),
            getAddressHistory: vi.fn().mockResolvedValue([{
                action: 'SEND',
                action_index: '42',
                block_index: 5_500_000,
                timestamp: Math.floor(Date.now() / 1000),
                tx_hash: 'doge-history-txid',
                status: 'valid',
                details: {
                    tick: 'DOGE',
                    amount: '12.50000000',
                    source: OUR_ADDRESS,
                    destination: OTHER_ADDRESS,
                },
            }]),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockResolvedValue([]),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 5_500_010 }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            listContacts: vi.fn().mockResolvedValue([]),
        });

        const view = render(provider(
            messaging,
            <History walletId={WALLET_ID} accountId="doge-account" />,
        ));

        expect(await screen.findByLabelText('Sent 12.5 DOGE')).toHaveTextContent('-12.5 DOGE');
        expect(screen.getByRole('button', { name: /Send.*Confirmed/i })).toHaveTextContent('Dogecoin');
        expect(view.container.querySelector('[data-history-key]'))
            .toHaveAttribute('data-history-key', `${CHAIN_ID}:42:${OUR_ADDRESS}`);
        expect(messaging.getAddressHistory).toHaveBeenCalledWith({
            chainId: CHAIN_ID,
            address: OUR_ADDRESS,
        });
    });
});
