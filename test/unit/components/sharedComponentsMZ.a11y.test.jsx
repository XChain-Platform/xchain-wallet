// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketChart } from '../../../packages/core/src/shared/components/MarketChart.jsx';
import { MarketLifecycleTimeline } from '../../../packages/core/src/shared/components/MarketLifecycleTimeline.jsx';
import { MessageConfirmScreen } from '../../../packages/core/src/shared/components/MessageConfirmScreen.jsx';
import { MnemonicGrid } from '../../../packages/core/src/shared/components/MnemonicGrid.jsx';
import { NativeFeeToggle } from '../../../packages/core/src/shared/components/NativeFeeToggle.jsx';
import { NetworkFilter } from '../../../packages/core/src/shared/components/NetworkFilter.jsx';
import { NetworkFilterDropdown } from '../../../packages/core/src/shared/components/NetworkFilterDropdown.jsx';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';
import { OpenOrdersPanel } from '../../../packages/core/src/shared/components/OpenOrdersPanel.jsx';
import { OperatorPublisherMode } from '../../../packages/core/src/shared/components/OperatorPublisherMode.jsx';
import { OrderbookPanel } from '../../../packages/core/src/shared/components/OrderbookPanel.jsx';
import { OriginIdentity } from '../../../packages/core/src/shared/components/OriginIdentity.jsx';
import { OwnAddressPickerScreen } from '../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx';
import { OwnerWithdrawWarning } from '../../../packages/core/src/shared/components/OwnerWithdrawWarning.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';
import { PlatformSwitcher } from '../../../packages/core/src/shared/components/PlatformSwitcher.jsx';
import { PortfolioChart } from '../../../packages/core/src/shared/components/PortfolioChart.jsx';
import { PreflightPanel } from '../../../packages/core/src/shared/components/PreflightPanel.jsx';
import { PriceAlertForm } from '../../../packages/core/src/shared/components/PriceAlertForm.jsx';
import { PsbtConfirmScreen } from '../../../packages/core/src/shared/components/PsbtConfirmScreen.jsx';
import { PsbtIntentPanel } from '../../../packages/core/src/shared/components/PsbtIntentPanel.jsx';
import { QueuedBroadcastBanner } from '../../../packages/core/src/shared/components/QueuedBroadcastBanner.jsx';
import { QueuedResultPanel } from '../../../packages/core/src/shared/components/QueuedResultPanel.jsx';
import { RawPsbtViewer } from '../../../packages/core/src/shared/components/RawPsbtViewer.jsx';
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { RecentTradesPanel } from '../../../packages/core/src/shared/components/RecentTradesPanel.jsx';
import { RelativeTime } from '../../../packages/core/src/shared/components/RelativeTime.jsx';
import { ResumeConfirmCard } from '../../../packages/core/src/shared/components/ResumeConfirmCard.jsx';
import { RouteErrorBoundary } from '../../../packages/core/src/shared/components/RouteErrorBoundary.jsx';
import { SignCredentials } from '../../../packages/core/src/shared/components/SignCredentials.jsx';
import { Sparkline } from '../../../packages/core/src/shared/components/Sparkline.jsx';
import { StalenessLabel } from '../../../packages/core/src/shared/components/StalenessLabel.jsx';
import { TickItemsEditor } from '../../../packages/core/src/shared/components/TickItemsEditor.jsx';
import { TickMemberName } from '../../../packages/core/src/shared/components/TickMemberName.jsx';
import { TickerIcon } from '../../../packages/core/src/shared/components/TickerIcon.jsx';
import { TokenField } from '../../../packages/core/src/shared/components/TokenField.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';
import { TradeHistoryPanel } from '../../../packages/core/src/shared/components/TradeHistoryPanel.jsx';
import { TxStatusTimeline } from '../../../packages/core/src/shared/components/TxStatusTimeline.jsx';
import { UndoSendToast } from '../../../packages/core/src/shared/components/UndoSendToast.jsx';
import { UpdateNoticeBanner } from '../../../packages/core/src/shared/components/UpdateNoticeBanner.jsx';
import { WatchOnlyBadge } from '../../../packages/core/src/shared/components/WatchOnlyBadge.jsx';
import { WatcherResultPanel } from '../../../packages/core/src/shared/components/WatcherResultPanel.jsx';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';

vi.mock('lightweight-charts', () => ({
    createChart: () => ({
        addLineSeries: () => ({ setData: vi.fn(), applyOptions: vi.fn() }),
        timeScale: () => ({ fitContent: vi.fn() }),
        applyOptions: vi.fn(),
        remove: vi.fn(),
    }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        loading: false,
        overall: 'degraded',
        perChain: [],
        refresh: vi.fn(),
        lastChecked: null,
    }),
}));

vi.mock('../../../packages/core/src/flows/directUpdate.js', () => ({
    hasDirectUpdateLane: () => true,
    checkForUpdateNotice: vi.fn().mockResolvedValue({
        version: '1.2.3',
        notice: 'XChain Wallet 1.2.3 is available.',
    }),
}));

afterEach(() => {
    cleanup();
    sessionStorage.clear();
});

const noop = () => {};
const pending = () => new Promise(() => {});

function withMessaging(child, messaging = {}) {
    return (
        <MessagingProvider
            shell="web"
            messaging={{ getSettings: vi.fn().mockResolvedValue({}), ...messaging }}
        >
            {child}
        </MessagingProvider>
    );
}

function confirmState() {
    return {
        phase: 'ready',
        composed: {},
        report: null,
        acknowledged: new Set(),
        acknowledge: noop,
        approve: noop,
        reject: noop,
        error: null,
    };
}

const CHAIN_REGISTRY = {
    byCoin: (coin) => [{ id: `${coin}-mainnet`, displayName: coin === 'bitcoin' ? 'Bitcoin' : 'Litecoin' }],
};

const SOFTWARE_ADDRESS = {
    id: 'address-1',
    address: 'bc1qowner',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

const RENDER_CASES = [
    ['MarketChart', () => withMessaging(
        <MarketChart chainId="bitcoin-mainnet" tick1="XCHAIN" tick2="BTC" />,
        { getMarketHistory: pending },
    )],
    ['MarketLifecycleTimeline', () => (
        <MarketLifecycleTimeline
            messaging={{ getOrderLifecycle: pending }}
            kind="order"
            chainId="bitcoin-mainnet"
            address="bc1qowner"
            actionIndex={7}
            createdBlock={900000}
        />
    )],
    ['MessageConfirmScreen', () => (
        <MessageConfirmScreen
            confirmAction={confirmState()}
            message="I control this address."
            chainLabel="Bitcoin"
            signerReady={false}
            password=""
            onPasswordChange={noop}
        />
    )],
    ['MnemonicGrid', () => <MnemonicGrid mnemonic="alpha beta gamma delta" />],
    ['NativeFeeToggle', () => (
        <NativeFeeToggle checked={false} onChange={noop} coinTicker="BTC" />
    )],
    ['OpenOrdersPanel', () => withMessaging(
        <OpenOrdersPanel
            walletId="wallet-1"
            chainId="bitcoin-mainnet"
            tick1="XCHAIN"
            tick2="BTC"
        />,
        { getAddressesByChain: pending, getMarketOrders: pending },
    )],
    ['OperatorPublisherMode', () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: pending,
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
        };
        return withMessaging(
            <OperatorPublisherMode
                walletId="wallet-1"
                chainId="bitcoin-mainnet"
                address="bc1qowner"
                feed={{ action_index: 7 }}
                messaging={messaging}
                variant="full"
            />,
            messaging,
        );
    }],
    ['OrderbookPanel', () => withMessaging(
        <OrderbookPanel chainId="bitcoin-mainnet" tick1="XCHAIN" tick2="BTC" />,
        { getOrderbook: pending },
    )],
    ['NoticeModal', () => (
        <NoticeModal title="Saved" message="Your changes were saved." onClose={noop} />
    )],
    ['OriginIdentity', () => <OriginIdentity origin="https://wallet.example.test" />],
    ['OwnAddressPickerScreen', () => withMessaging(
        <OwnAddressPickerScreen
            walletId="wallet-1"
            accountId="account-1"
            chainId="bitcoin-mainnet"
            title="From address"
            onPick={noop}
            onBack={noop}
        />,
        {
            getAddressesByChain: pending,
            getActiveAddresses: pending,
            getAddressBalances: pending,
        },
    )],
    ['OwnerWithdrawWarning', () => <OwnerWithdrawWarning ownerWithdraw />],
    ['PlaceOrderPanel', () => withMessaging(
        <PlaceOrderPanel
            walletId="wallet-1"
            chainId="bitcoin-mainnet"
            tick1="XCHAIN"
            tick2="BTC"
        />,
        {
            getAddressesByChain: vi.fn().mockResolvedValue({
                'bitcoin-mainnet': [SOFTWARE_ADDRESS],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({
                'bitcoin-mainnet': SOFTWARE_ADDRESS.id,
            }),
            getWalletBalances: pending,
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
        },
    )],
    ['PortfolioChart', () => withMessaging(
        <PortfolioChart
            walletId="wallet-1"
            rows={[{
                kind: 'native',
                chainId: 'bitcoin-mainnet',
                tick: 'BTC',
                quantity: '50000000',
                divisibility: 8,
                fiatRate: 80000,
            }]}
        />,
        { getNativePricesRequest: pending },
    )],
    ['PreflightPanel', () => (
        <PreflightPanel
            report={{
                schemaVersion: 1,
                verdict: 'warn',
                restricted: false,
                findings: [{
                    code: 'RECIPIENT_UNVERIFIED',
                    severity: 'warning',
                    message: 'Recipient is unverified.',
                }],
                unverified: [],
            }}
            acknowledged={new Set()}
            onAcknowledge={noop}
        />
    )],
    ['PriceAlertForm', () => (
        <PriceAlertForm
            lockedChainId="bitcoin-mainnet"
            currentPrice={80000}
            onCreate={noop}
        />
    )],
    ['PsbtConfirmScreen', () => (
        <PsbtConfirmScreen
            confirmAction={confirmState()}
            decomposed={{
                inputs: [{ address: 'bc1qsource', value: 2000 }],
                outputs: [{ address: 'bc1qdestination', value: 1900 }],
            }}
            signingAddress="bc1qsource"
            decodedAction={{ summary: 'Send tokens to the named recipient.' }}
            chainLabel="Bitcoin"
            signerReady={false}
            password=""
            onPasswordChange={noop}
        />
    )],
    ['PsbtIntentPanel', () => (
        <PsbtIntentPanel
            decomposed={{
                inputs: [{ address: 'bc1qsource', value: 2000 }],
                outputs: [{ address: 'bc1qdestination', value: 1900 }],
            }}
            signingAddress="bc1qsource"
            decodedAction={{ summary: 'Send tokens to the named recipient.' }}
        />
    )],
    ['QueuedResultPanel', () => <QueuedResultPanel onDone={noop} unsaved />],
    ['RawPsbtViewer', () => (
        <RawPsbtViewer
            developerMode
            psbtHex="deadbeef"
            actionFields={{ action: 'SEND', memo: 'Review this payload' }}
        />
    )],
    ['ReachabilityBanner', () => <ReachabilityBanner />],
    ['RecentTradesPanel', () => withMessaging(
        <RecentTradesPanel chainId="bitcoin-mainnet" tick1="XCHAIN" tick2="BTC" />,
        { getMarketHistory: pending },
    )],
    ['RelativeTime', () => <RelativeTime timestamp={Date.now() - 60_000} />],
    ['ResumeConfirmCard', () => (
        <ResumeConfirmCard
            sessions={[{
                id: 'resume-1',
                createdAt: Date.now(),
                composed: { psbt: 'deadbeef', actionString: 'SEND|0|BTC|1|bc1qrecipient' },
                dispatch: { software: 'sendToken', label: 'Send 1 BTC', base: {} },
            }]}
            onResume={noop}
            onDiscard={noop}
        />
    )],
    ['SignCredentials', () => (
        <SignCredentials
            fromAddress={{ address: 'bc1qsource', source: 'hd' }}
            chainId="bitcoin-mainnet"
            password=""
            onPasswordChange={noop}
        />
    )],
    ['Sparkline', () => <Sparkline series={[1, 4, 2, 5]} label="Price history" />],
    ['StalenessLabel', () => <StalenessLabel lastSyncedAt={Date.now() - 120_000} />],
    ['TickItemsEditor', () => (
        <TickItemsEditor
            value="TOKEN"
            onChange={noop}
            items={{ valid: ['TOKEN'], invalid: [], duplicates: 0 }}
            chainId={null}
            chainLabel="Bitcoin"
            listCoin="BTC"
            messaging={null}
            onOpenPicker={noop}
            status={{}}
            onStatusChange={noop}
        />
    )],
    ['TickMemberName', () => (
        <TickMemberName item="TOKEN" messaging={null} chainId="bitcoin-mainnet" />
    )],
    ['TickerIcon', () => <TickerIcon chainId="bitcoin-mainnet" tick="BTC" />],
    ['TokenField', () => (
        <TokenField
            label="Asset"
            value={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
            onOpenPicker={noop}
        />
    )],
    ['TotalBalanceHero', () => withMessaging(
        <TotalBalanceHero rows={[]} walletId="wallet-1" networkFilter="all" />,
    )],
    ['TradeHistoryPanel', () => withMessaging(
        <TradeHistoryPanel
            walletId="wallet-1"
            chainId="bitcoin-mainnet"
            tick1="XCHAIN"
            tick2="BTC"
        />,
        { getAddressesByChain: pending, getMarketHistory: pending },
    )],
    ['TxStatusTimeline', () => (
        <TxStatusTimeline
            entry={{
                action: 'SEND',
                blockIndex: 900000,
                timestamp: Date.now() - 60_000,
                txHash: 'a'.repeat(64),
            }}
            chainTip={900002}
            indexerWatermark={900000}
        />
    )],
    ['UndoSendToast', () => (
        <UndoSendToast status="counting" remaining={5} onCancel={noop} />
    )],
    ['WatchOnlyBadge', () => <WatchOnlyBadge visible />],
    ['WatcherResultPanel', () => (
        <WatcherResultPanel result={{ psbtHex: 'deadbeef' }} onDone={noop} />
    )],
];

describe('shared components M to Z accessibility', () => {
    it.each(RENDER_CASES)('%s has no serious axe violations', async (_name, fixture) => {
        const { container } = render(fixture());
        await expectNoSeriousAxeViolations(container);
    });

    it('NetworkFilterDropdown has no serious axe violations while open', async () => {
        const { container } = render(
            <NetworkFilterDropdown value="all" onChange={noop} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Filter by network' }));
        await expectNoSeriousAxeViolations(container);
    });

    it('NetworkFilter has no serious axe violations while open', async () => {
        const { container } = render(
            <NetworkFilter
                chainRegistry={CHAIN_REGISTRY}
                coinFamilies={['bitcoin', 'litecoin']}
                value="all"
                onChange={noop}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /All networks/ }));
        await expectNoSeriousAxeViolations(container);
    });

    it('PlatformSwitcher has no serious axe violations while open', async () => {
        const { container } = render(<PlatformSwitcher current="wallet" />);
        fireEvent.click(screen.getByRole('button', { name: 'XChain platform sites' }));
        await expectNoSeriousAxeViolations(container);
    });

    it('RouteErrorBoundary recovery has no serious axe violations', async () => {
        let boundary;
        const { container } = render(
            <RouteErrorBoundary ref={(instance) => { boundary = instance; }} onHome={noop} onReload={noop}>
                <p>Route content</p>
            </RouteErrorBoundary>,
        );
        act(() => boundary.setState({ failed: true }));
        await expectNoSeriousAxeViolations(container);
    });

    it('QueuedBroadcastBanner has no serious axe violations with a queued transaction', async () => {
        const { container } = render(withMessaging(
            <QueuedBroadcastBanner walletId="wallet-1" intervalMs={0} />,
            {
                listQueuedBroadcasts: vi.fn().mockResolvedValue([{
                    id: 'queued-1',
                    chainId: 'bitcoin-mainnet',
                    summary: 'Send 1 BTC',
                    signedAt: Date.now(),
                }]),
            },
        ));
        await screen.findByText('Send 1 BTC');
        await expectNoSeriousAxeViolations(container);
    });

    it('UpdateNoticeBanner has no serious axe violations when an update is available', async () => {
        const { container } = render(<UpdateNoticeBanner />);
        await screen.findByText('XChain Wallet 1.2.3 is available.');
        await expectNoSeriousAxeViolations(container);
    });
});
