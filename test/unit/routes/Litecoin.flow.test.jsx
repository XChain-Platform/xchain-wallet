// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { DestroyForm } from '../../../packages/core/src/shared/routes/DestroyForm.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { composeForConfirm as composeWithSdk } from '../../../packages/core/src/flows/composeForConfirm.js';
import { registry as registryLib } from '@xchain-wallet/core';

const { qrToDataURL } = vi.hoisted(() => ({
    qrToDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: qrToDataURL },
}));

const { Receive } = await import('../../../packages/core/src/shared/routes/Receive.jsx');

const CHAIN = 'litecoin-mainnet';
const WALLET_ID = 'litecoin-flow-wallet';
const SOURCE = Object.freeze({
    id: 'ltc-source',
    address: 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9',
    addressType: 'p2wpkh',
    publicKey: '02ab',
    derivationPath: "m/84'/2'/0'/0/0",
    source: 'hd',
    label: 'Litecoin savings',
});
const DESTINATION = 'ltc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3nmndwj';
const FEE_DESTINATION = 'ltc1qxvenxvenxvenxvenxvenxvenxvenxvenwcpknh';

function proxyMessaging(base) {
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[property] = stub;
            return stub;
        },
    });
}

function provider(messaging, child) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>{child}</ToastHost>
        </MessagingProvider>
    );
}

function baseSettings() {
    return {
        activeNetwork: 'mainnet',
        walletMode: 'full',
        grace: { testSendThresholdSats: 0 },
        privacy: { formDraftTtlMs: 0 },
    };
}

function mountSend() {
    const messaging = proxyMessaging({
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue(baseSettings()),
        updateSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        estimateFee: vi.fn().mockResolvedValue({
            unit: 'sat/vB',
            minimumRate: 1,
            low: { rate: 2, etaMinutes: 8 },
            normal: { rate: 4, etaMinutes: 4 },
            fast: { rate: 8, etaMinutes: 2 },
        }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff',
            encoding: 'OP_RETURN',
            actionString: null,
            action: null,
            version: null,
            bareNativePayment: true,
            chainId: CHAIN,
            networkFeeSats: 1000,
            decoded: null,
            simulation: null,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    });
    render(provider(messaging, <Send walletId={WALLET_ID} onBack={() => {}} />));
    return messaging;
}

beforeEach(() => {
    qrToDataURL.mockClear();
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('Litecoin receive flow', () => {
    it('shows a native SegWit address and encodes the same Litecoin payment request in the QR', async () => {
        const messaging = proxyMessaging({
            getSettings: vi.fn().mockResolvedValue(baseSettings()),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
            getNewestAddress: vi.fn().mockResolvedValue(SOURCE),
        });
        render(provider(messaging, <Receive walletId={WALLET_ID} />));

        const address = await screen.findByRole('textbox', {
            name: 'Copy payment request for receive address',
        });
        expect(address).toHaveValue(SOURCE.address);
        expect(address.value).toMatch(/^ltc1q/);
        expect(screen.getByLabelText('Address type')).toHaveValue('p2wpkh');
        expect(screen.getByRole('option', { name: 'SegWit' })).toBeInTheDocument();

        fireEvent.change(screen.getByRole('textbox', { name: 'Amount (LTC)' }), {
            target: { value: '0.125' },
        });
        await waitFor(() => expect(qrToDataURL.mock.calls.some(
            ([payload]) => payload.includes('amount=0.125'),
        )).toBe(true));

        const payload = qrToDataURL.mock.calls.findLast(
            ([value]) => value.includes('amount=0.125'),
        )[0];
        const [paymentTarget, query = ''] = payload.split('?');
        const params = new URLSearchParams(query);
        expect(paymentTarget).toBe(`litecoin:${SOURCE.address}`);
        expect(params.get('amount')).toBe('0.125');
        expect(params.get('chain')).toBe(CHAIN);
        expect(params.get('label')).toBe(SOURCE.label);
    });
});

describe('Litecoin send flow', () => {
    it('enforces the Litecoin dust floor and composes a valid address with sat/vB fee units', async () => {
        const messaging = mountSend();

        expect(await screen.findByLabelText('From')).toHaveValue(SOURCE.address);
        await waitFor(() => expect(messaging.estimateFee).toHaveBeenCalledWith({ chainId: CHAIN }));
        expect(screen.getByRole('button', { name: 'Edit fee rate (sat/vB)' }))
            .toHaveTextContent('4 sat/vB');
        expect(screen.getByRole('button', { name: 'Edit exact fee amount' }).closest('[role="status"]'))
            .toHaveTextContent('0.00001 LTC');

        fireEvent.change(screen.getByLabelText(/^To$/), { target: { value: DESTINATION } });
        const amount = screen.getByLabelText('Amount (LTC)');
        fireEvent.change(amount, { target: { value: '0.00005459' } });
        expect(await screen.findByText(/smallest LTC payment/)).toHaveTextContent(
            '0.0000546 LTC (5,460 sats)',
        );
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(amount, { target: { value: '0.0000546' } });
        await waitFor(() => expect(screen.queryByText(/smallest LTC payment/)).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN,
            to: DESTINATION,
            tick: 'LTC',
            amount: '0.0000546',
            feePerKb: 4000,
        }));
    });
});

describe('Litecoin native protocol fee flow', () => {
    it('adds the mandatory fee output before a fee-bearing XChain action reaches review', async () => {
        const chainRegistry = registryLib.defaultRegistry();
        const createTx = vi.fn(async () => ({
            psbt: '70736274ff',
            encoding: 'OP_RETURN',
        }));
        const sdk = {
            actions: {
                createAction: vi.fn(() => ({
                    actionString: 'DESTROY|0|XCHAIN|1',
                    action: 'DESTROY',
                    version: 0,
                })),
            },
            encoder: { createTx },
            quoteNativeFee: vi.fn().mockResolvedValue({
                supported: true,
                valid: true,
                requiredFeeSats: 5000,
                feeDestination: FEE_DESTINATION,
            }),
            wallet: { getBitcoinNetwork: () => ({ dustThreshold: 5460 }) },
        };
        const sdkRegistry = { get: () => sdk };
        const vault = {
            settings: { get: vi.fn().mockResolvedValue({ ads: { enabled: false, perChain: {} } }) },
        };
        const messaging = proxyMessaging({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
            getSettings: vi.fn().mockResolvedValue(baseSettings()),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN,
                tick: 'XCHAIN',
                divisibility: 8,
                locks: {},
            }),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: SOURCE.address,
                    balances: {
                        native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
                        tokens: [{ tick: 'XCHAIN', quantity: '200000000', divisibility: 8 }],
                    },
                }],
            }),
            composeForConfirm: vi.fn(async (request) => {
                const composed = await composeWithSdk({
                    sdkRegistry,
                    chainRegistry,
                    vault,
                    chainId: request.chainId,
                    actionData: request.actionData,
                    encoderOpts: {
                        ...request.encoderOpts,
                        pubkey: request.from.publicKey,
                        change: request.from.address,
                    },
                    source: request.from.address,
                });
                return {
                    ...composed,
                    chainId: CHAIN,
                    networkFeeSats: 1000,
                    protocolFeeSats: 5460,
                    decoded: {
                        summary: 'Destroy 1 XCHAIN',
                        details: [],
                        warnings: ['Destroy is irreversible.'],
                    },
                    simulation: null,
                };
            }),
            preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        });
        render(provider(messaging, (
            <DestroyForm
                walletId={WALLET_ID}
                initialChainId={CHAIN}
                initialTick="XCHAIN"
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        )));

        expect(await screen.findByText('Protocol fees are paid in LTC')).toBeInTheDocument();
        await waitFor(() => expect(document.body.textContent).toContain('2 XCHAIN available'));
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Destroy' }));

        expect(await screen.findByTestId('confirm-modal')).toBeInTheDocument();
        expect(sdk.quoteNativeFee).toHaveBeenCalledTimes(1);
        expect(createTx.mock.calls[0][0]).not.toHaveProperty('payFeeInNativeCoin');
        expect(createTx.mock.calls[0][0].customOutputs).toContainEqual({
            address: FEE_DESTINATION,
            value: 5460,
        });
    });
});

describe('Litecoin history flow', () => {
    it('renders an explorer-shaped incoming Litecoin send with its native amount', async () => {
        const external = 'ltc1qxvenxvenxvenxvenxvenxvenxvenxvenwcpknh';
        const messaging = proxyMessaging({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
            getAddressHistory: vi.fn().mockResolvedValue([{
                action: 'SEND',
                action_index: '91',
                block_index: 1234,
                timestamp: 1791900000,
                tx_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0',
                details: {
                    source: external,
                    destination: SOURCE.address,
                    tick: 'LTC',
                    amount: '0.12500000',
                },
            }]),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockResolvedValue([]),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 1234 }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            getSettings: vi.fn().mockResolvedValue({}),
        });
        render(provider(messaging, <History walletId={WALLET_ID} />));

        const row = await screen.findByRole('button', { name: /Send.*Confirmed/i });
        expect(row).toHaveTextContent(/Litecoin/);
        expect(row).toHaveTextContent('+0.125 LTC');
        expect(messaging.getAddressHistory).toHaveBeenCalledWith({
            chainId: CHAIN,
            address: SOURCE.address,
        });
    });
});
