// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: fiat values belong to mainnet assets only.
//
//   [P1] 2026-10-13: Testnet and regtest surfaces must not assign the
//        corresponding mainnet coin price to test coins or their fees.

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { TotalBalanceHero } from '../../packages/core/src/shared/components/TotalBalanceHero.jsx';
import { ActionConfirmScreen } from '../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { TokenDetail } from '../../packages/core/src/shared/routes/TokenDetail.jsx';
import { Receive } from '../../packages/core/src/shared/routes/Receive.jsx';
import { useFeeFiat } from '../../packages/core/src/shared/hooks/useFeeFiat.js';
import { defaultRegistry } from '../../packages/core/src/registry/index.js';
import { tickerForDescriptor } from '../../packages/core/src/registry/coinTicker.js';
import {
    configureFiatRateSource,
    refreshFiatRates,
    refreshTokenFiatRate,
    _resetPriceLookupForTests,
} from '../../packages/core/src/flows/priceLookup.js';

const { qrToDataURL } = vi.hoisted(() => ({
    qrToDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: qrToDataURL },
}));

const NOW = Date.parse('2026-10-13T12:00:00Z');
const FRESH_TS = Math.floor(NOW / 1000) - 60;
const NETWORKS = [
    { chainId: 'bitcoin-testnet', networkKind: 'testnet', showsFiat: false },
    { chainId: 'bitcoin-regtest', networkKind: 'regtest', showsFiat: false },
    { chainId: 'bitcoin-mainnet', networkKind: 'mainnet', showsFiat: true },
];
const REGISTRY = defaultRegistry();
const originalResizeObserver = globalThis.ResizeObserver;

function settingsFor(networkKind, chainId) {
    return {
        activeNetwork: networkKind,
        lastUsedChainId: chainId,
        fiatCurrency: 'USD',
        walletMode: 'full',
        privacy: { priceDataEnabled: true },
    };
}

function pricedRow(chainId) {
    return {
        kind: 'native',
        chainId,
        tick: tickerForDescriptor(REGISTRY.get(chainId)),
        quantity: '100000000',
        divisibility: 8,
        fiatRate: 50000,
    };
}

function provider(messaging, child) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            {child}
        </MessagingProvider>
    );
}

function surfaceMessaging(networkKind, chainId) {
    return {
        getSettings: vi.fn(async () => settingsFor(networkKind, chainId)),
        getNativePricesRequest: vi.fn(async () => ({ disabled: true })),
        getAddressesByChain: vi.fn(async () => ({ [chainId]: [] })),
        listPriceAlertsForWallet: vi.fn(async () => []),
    };
}

function renderHome(chainId, networkKind) {
    const messaging = surfaceMessaging(networkKind, chainId);
    render(provider(
        messaging,
        <TotalBalanceHero
            rows={[pricedRow(chainId)]}
            walletId="wallet-1"
            networkFilter="all"
        />,
    ));
    return screen.getByRole('region', { name: 'Active address balance' });
}

function renderTokenDetail(chainId, networkKind) {
    const descriptor = REGISTRY.get(chainId);
    const messaging = surfaceMessaging(networkKind, chainId);
    render(provider(
        messaging,
        <TokenDetail
            walletId="wallet-1"
            chainId={chainId}
            tick={tickerForDescriptor(descriptor)}
            kind="native"
            quantity="100000000"
            divisibility={8}
            fiatRate={50000}
            onBack={() => {}}
        />,
    ));
    return screen.getByRole('region', {
        name: `${tickerForDescriptor(descriptor)} balance`,
    });
}

async function primeFiatRates() {
    configureFiatRateSource({
        now: () => NOW,
        explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
        fetch: vi.fn(async () => ({
            ok: true,
            json: async () => ({
                data: [
                    { coin_pair: 'BTC/USD', price: '50000', block_timestamp: FRESH_TS },
                    { coin_pair: 'XCHAIN/USD', price: '2', block_timestamp: FRESH_TS },
                ],
            }),
        })),
    });
    await refreshFiatRates({ chainCoins: ['bitcoin'], fiatCurrency: 'USD' });
    await refreshTokenFiatRate({
        chainCoin: 'bitcoin',
        tick: 'XCHAIN',
        nativeTicker: 'BTC',
        fiatCurrency: 'USD',
    });
}

async function renderReceive(chainId, networkKind) {
    const descriptor = REGISTRY.get(chainId);
    const address = {
        id: `${networkKind}-address`,
        address: `${networkKind}-receive-address`,
        addressType: descriptor.defaultAddressType,
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        label: `${networkKind} deposits`,
    };
    const messaging = {
        getSettings: vi.fn(async () => settingsFor(networkKind, chainId)),
        getAddressesByChain: vi.fn(async () => ({ [chainId]: [address] })),
        getNewestAddress: vi.fn(async () => address),
    };
    render(provider(
        messaging,
        <Receive
            walletId="wallet-1"
            prefill={{ chainId, tick: tickerForDescriptor(descriptor) }}
        />,
    ));
    return screen.findByRole('textbox', {
        name: `Amount (${tickerForDescriptor(descriptor)})`,
    });
}

function FeeRows({ chainId }) {
    const descriptor = REGISTRY.get(chainId);
    const ticker = tickerForDescriptor(descriptor);
    const { formatNativeFee, formatProtocolFee } = useFeeFiat({
        chainId,
        chainCoin: descriptor.coin,
        nativeTicker: ticker,
        settings: { fiatCurrency: 'USD', privacy: { priceDataEnabled: true } },
    });
    const confirmAction = {
        phase: 'ready',
        composed: {
            psbt: 'test-psbt',
            chainId,
            networkFeeSats: 1000,
            decoded: {
                summary: 'Issue TEST',
                details: [],
                warnings: [],
            },
        },
        report: {
            verdict: 'pass',
            restricted: false,
            findings: [],
            unverified: [],
            quote: { valid: true, xchainFee: '1' },
        },
        acknowledged: new Set(),
        acknowledge: vi.fn(),
        canApprove: true,
        approve: vi.fn(),
        reject: vi.fn(),
        error: null,
        source: null,
    };
    return (
        <ActionConfirmScreen
            confirmAction={confirmAction}
            chainId={chainId}
            chainLabel={descriptor.displayName}
            coinTicker={ticker}
            signerReady
            password=""
            onPasswordChange={() => {}}
            formatNativeFee={formatNativeFee}
            formatProtocolFee={formatProtocolFee}
        />
    );
}

beforeEach(() => {
    localStorage.clear();
    _resetPriceLookupForTests();
    qrToDataURL.mockClear();
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        disconnect() {}
    };
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    _resetPriceLookupForTests();
    globalThis.ResizeObserver = originalResizeObserver;
});

describe('regression/test-networks-no-fiat', () => {
    it.each(NETWORKS)(
        '[REGRESSION P1] keeps Home and TokenDetail fiat aligned with $networkKind policy',
        async ({ chainId, networkKind, showsFiat }) => {
            const home = renderHome(chainId, networkKind);
            if (showsFiat) expect(home).toHaveTextContent('$50,000.00');
            else expect(home).not.toHaveTextContent('$');

            cleanup();
            const detail = renderTokenDetail(chainId, networkKind);
            if (showsFiat) expect(detail).toHaveTextContent('$50,000.00');
            else expect(detail).not.toHaveTextContent('$');
        },
    );

    it.each(NETWORKS)(
        '[REGRESSION P1] keeps the Receive fiat line aligned with $networkKind policy',
        async ({ chainId, networkKind, showsFiat }) => {
            await primeFiatRates();
            await renderReceive(chainId, networkKind);

            if (showsFiat) {
                expect(await screen.findByRole('button', { name: 'Switch input to USD' }))
                    .toHaveTextContent('$0.00');
            } else {
                await waitFor(() => {
                    expect(screen.queryByRole('button', { name: 'Switch input to USD' })).toBeNull();
                });
                expect(document.body).not.toHaveTextContent('$');
            }
        },
    );

    it.each(NETWORKS)(
        '[REGRESSION P1] keeps fee-row fiat aligned with $networkKind policy',
        async ({ chainId, networkKind, showsFiat }) => {
            await primeFiatRates();
            render(<FeeRows chainId={chainId} />);

            const networkFee = screen.getByTestId('confirm-fee');
            const protocolFee = screen.getByTestId('confirm-protocol-fee');
            await waitFor(() => {
                if (showsFiat) {
                    expect(networkFee).toHaveTextContent('$0.50');
                    expect(protocolFee).toHaveTextContent('$2.00');
                } else {
                    expect(networkFee).not.toHaveTextContent('$');
                    expect(protocolFee).not.toHaveTextContent('$');
                }
            });
        },
    );
});
