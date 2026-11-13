// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { registry as registryLib } from '@xchain-wallet/core';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { markDemoWallet, clearDemoWalletId } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { ActionIntentSummary } from '../../../packages/core/src/shared/components/ActionIntentSummary.jsx';
import { ActivityRow } from '../../../packages/core/src/shared/components/ActivityRow.jsx';
import { AddressDiscoveryNotice } from '../../../packages/core/src/shared/components/AddressDiscoveryNotice.jsx';
import { AdsNotice } from '../../../packages/core/src/shared/components/AdsNotice.jsx';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { BackupReminderCard } from '../../../packages/core/src/shared/components/BackupReminderCard.jsx';
import { BalanceChanges } from '../../../packages/core/src/shared/components/BalanceChanges.jsx';
import { BalanceHeroMenu } from '../../../packages/core/src/shared/components/BalanceHeroMenu.jsx';
import { BalanceList } from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { BalancesUncheckedState } from '../../../packages/core/src/shared/components/BalancesUncheckedState.jsx';
import { BetMarketCard } from '../../../packages/core/src/shared/components/BetMarketCard.jsx';
import { BetMyBetsPanel } from '../../../packages/core/src/shared/components/BetMyBetsPanel.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import {
    ConfirmAddressCard,
    ConfirmChangesCard,
    ConfirmCostCard,
    ConfirmHero,
    ConfirmNotice,
} from '../../../packages/core/src/shared/components/ConfirmSummary.jsx';
import { DispenserExplorerCard } from '../../../packages/core/src/shared/components/DispenserExplorerCard.jsx';
import { FileField } from '../../../packages/core/src/shared/components/FileField.jsx';
import { ListFilterMenu } from '../../../packages/core/src/shared/components/ListFilterMenu.jsx';
import { ListFilterPopover } from '../../../packages/core/src/shared/components/ListFilterPopover.jsx';
import { ListSearchField } from '../../../packages/core/src/shared/components/ListSearchField.jsx';
import { CollectiblesView } from '../../../packages/core/src/shared/components/CollectiblesView.jsx';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import { ConfirmModal } from '../../../packages/core/src/shared/components/ConfirmModal.jsx';
import { ContactsPickerScreen } from '../../../packages/core/src/shared/components/ContactsPickerScreen.jsx';
import { DurationSlider } from '../../../packages/core/src/shared/components/DurationSlider.jsx';
import { ContractConsentPanel } from '../../../packages/core/src/shared/components/ContractConsentPanel.jsx';
import { DemoExitConfirm } from '../../../packages/core/src/shared/components/DemoExitConfirm.jsx';
import { DerivationPathCrossCheck } from '../../../packages/core/src/shared/components/DerivationPathCrossCheck.jsx';
import { DiagnosticDetails } from '../../../packages/core/src/shared/components/DiagnosticDetails.jsx';
import { DispenserBadge, __clearDispenserBadgeCache } from '../../../packages/core/src/shared/components/DispenserBadge.jsx';
import { DraftDiscardButton } from '../../../packages/core/src/shared/components/DraftDiscardButton.jsx';
import { EmptyStateNudge } from '../../../packages/core/src/shared/components/EmptyStateNudge.jsx';
import { FeesCard } from '../../../packages/core/src/shared/components/FeesCard.jsx';
import { GatedFileViewer } from '../../../packages/core/src/shared/components/GatedFileViewer.jsx';
import { HeaderActionMenu } from '../../../packages/core/src/shared/components/HeaderActionMenu.jsx';
import { HomeFilterBar } from '../../../packages/core/src/shared/components/HomeFilterBar.jsx';
import { HomeListFilterMenu } from '../../../packages/core/src/shared/components/HomeListFilterMenu.jsx';
import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { HwFirmwareBanner } from '../../../packages/core/src/shared/components/HwFirmwareBanner.jsx';
import { HwSignBlock } from '../../../packages/core/src/shared/components/HwSignBlock.jsx';
import { KeyQR } from '../../../packages/core/src/shared/components/KeyQR.jsx';
import { LayoutModeToggle } from '../../../packages/core/src/shared/components/LayoutModeToggle.jsx';
import { LearnNote } from '../../../packages/core/src/shared/components/LearnNote.jsx';
import { LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ListToolbar } from '../../../packages/core/src/shared/components/ListToolbar.jsx';
import { ListPickerScreen } from '../../../packages/core/src/shared/components/ListPickerScreen.jsx';
import { LockedSendOutcomeNotice } from '../../../packages/core/src/shared/components/LockedSendOutcomeNotice.jsx';
import { LockedTokenContext } from '../../../packages/core/src/shared/components/LockedTokenContext.jsx';
import { LogConsole } from '../../../packages/core/src/shared/components/LogConsole.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgo=') },
}));

const noop = () => {};
const chainRegistry = registryLib.defaultRegistry();
const settings = createDefaultSettings();
const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const decoded = {
    summary: 'Send 1 BTC',
    details: [
        { label: 'Destination', value: address },
        { label: 'Amount', value: '1' },
    ],
    warnings: [],
};
const confirmAction = {
    phase: 'ready',
    composed: { bareNativePayment: true, chainId: 'bitcoin-mainnet', decoded },
    report: null,
    acknowledged: new Set(),
    acknowledge: noop,
    canApprove: true,
    approve: noop,
    reject: noop,
    error: null,
    source: address,
};
const messaging = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
    getAddressesByChain: vi.fn().mockResolvedValue({}),
    listWallets: vi.fn().mockResolvedValue([]),
    getOwnedTokens: vi.fn().mockResolvedValue([]),
    getDispensersForToken: vi.fn().mockResolvedValue([{
        status: 'valid',
        current_status: 'open',
        give_remaining: '1',
    }]),
};

function withMessaging(node) {
    return (
        <MessagingContext.Provider value={{ shell: 'web', messaging }}>
            {node}
        </MessagingContext.Provider>
    );
}

const fixtures = [
    ['ActionConfirmScreen', () => withMessaging(
        <ActionConfirmScreen
            confirmAction={confirmAction}
            walletId="wallet-1"
            chainLabel="Bitcoin"
            signerReady={false}
            password="secret"
            onPasswordChange={noop}
        />,
    )],
    ['ActionIntentSummary', () => (
        <ActionIntentSummary
            decoded={decoded}
            simulation={{ deltas: [{ tick: 'BTC', before: '2', after: '1' }] }}
        />
    )],
    ['ActivityRow', () => (
        <ul>
            <li>
                <ActivityRow
                    chainId="bitcoin-mainnet"
                    tick="BTC"
                    isNative
                    label="Sent"
                    context="bc1qexampleexampleexampleexampleexample0"
                    amount="-0.01 BTC"
                    status="confirmed"
                    block="Block 123,456"
                    timestamp={1700000000}
                    onClick={noop}
                />
            </li>
        </ul>
    )],
    // A finished scan with an unread chain shows its warning line and the Try again control.
    ['AddressDiscoveryNotice', () => (
        <MessagingContext.Provider
            value={{
                shell: 'web',
                messaging: {
                    ...messaging,
                    addressDiscoveryStatus: vi.fn().mockResolvedValue({
                        id: 1,
                        status: 'done',
                        chainsDone: 2,
                        chainsTotal: 3,
                        found: 1,
                        failedChains: ['bitcoin-mainnet'],
                        walletIds: ['wallet-1'],
                    }),
                    addressDiscoveryDismiss: vi.fn().mockResolvedValue(undefined),
                    discoverAddresses: vi.fn().mockResolvedValue(undefined),
                },
            }}
        >
            <AddressDiscoveryNotice />
        </MessagingContext.Provider>
    ), () => screen.findByTestId('address-discovery-status')],
    ['AdsNotice', () => <AdsNotice onContinue={noop} />],
    ['AmountField', () => (
        <AmountField
            amount="1"
            tick="BTC"
            onAmountFieldChange={noop}
            onMax={noop}
            balanceText="2 BTC available"
        />
    )],
    ['AppHeader', () => (
        <AppHeader
            onMenuToggle={noop}
            onLock={noop}
            activeWallet={{ id: 'wallet-1', name: 'Primary wallet' }}
        />
    )],
    ['BackupReminderCard', () => (
        <BackupReminderCard walletId="wallet-1" walletCreatedAt="2025-01-01T00:00:00.000Z" onAction={noop} />
    )],
    ['BalanceChanges', () => (
        <BalanceChanges result={{ deltas: [{ tick: 'BTC', before: '2', after: '1' }] }} />
    )],
    ['BalanceHeroMenu', () => (
        <BalanceHeroMenu
            items={[
                { id: 'currency', label: 'Show balance in BTC', Icon: () => <svg aria-hidden="true" />, onSelect: noop },
                { id: 'chart', label: 'Hide chart', Icon: () => <svg aria-hidden="true" />, onSelect: noop, checked: true },
            ]}
        />
    )],
    ['BalanceList', () => (
        <BalanceList rows={[{
            chainId: 'bitcoin-mainnet',
            tick: 'BTC',
            displayName: 'Bitcoin',
            kind: 'native',
            quantity: '100000000',
            divisibility: 8,
        }]} onSelectToken={noop} />
    )],
    ['BalancesUncheckedState', () => (
        <BalancesUncheckedState onRetry={noop} onReceive={noop} />
    )],
    ['BetMarketCard', () => (
        <BetMarketCard
            market={{
                action_index: 7,
                label: 'Will it rain tomorrow?',
                tick: 'XCHAIN',
                feed_status: 'open',
                deadline: Math.floor(Date.now() / 1000) + 86400 * 3,
                pools: [{ outcome: 0, pool: '2' }, { outcome: 1, pool: '1' }],
            }}
            onOpen={noop}
        />
    )],
    ['BetMyBetsPanel', () => (
        <BetMyBetsPanel
            rows={[
                { chainId: 'bitcoin-mainnet', action_index: 1, feed_action_index: 7, outcome: 0, bet_status: 'open', amount: '1', tick: 'XCHAIN', owner: address },
                { chainId: 'bitcoin-mainnet', action_index: 2, feed_action_index: 8, outcome: 1, bet_status: 'won', amount: '2', tick: 'XCHAIN', owner: address, settled_block: 12 },
            ]}
            error={null}
            onRetry={noop}
            messaging={{ betFeed: vi.fn().mockResolvedValue(null) }}
            onOpenMarket={noop}
        />
    )],
    ['BottomTabBar', () => (
        <BottomTabBar currentView="home" onSelect={noop} onOpenSettings={noop} />
    )],
    ['CollectiblesView', () => withMessaging(
        <CollectiblesView rows={[{
            chainId: 'bitcoin-mainnet',
            tick: 'NFTTEST',
            displayName: 'Test collectible',
            quantity: '1',
            divisibility: 0,
            fiatRate: null,
        }]} demo onSelectToken={noop} />
    )],
    ['ConfirmActionModal', () => (
        <ConfirmActionModal
            phase="ready"
            composed={{ bareNativePayment: true }}
            report={null}
            acknowledged={new Set()}
            onAcknowledge={noop}
            canApprove
            onApprove={noop}
            onReject={noop}
            decoded={decoded}
            chainLabel="Bitcoin"
            credentials={<label>Password<input type="password" /></label>}
            credentialsReady
        />
    )],
    ['ConfirmSummary', () => (
        <main>
            <ConfirmHero
                summary={{ verb: 'Send', amount: '1', ticker: 'BTC', direction: 'out', chainId: 'bitcoin-mainnet', recipient: address }}
            />
            <ConfirmAddressCard address={address} />
            <ConfirmChangesCard rows={[{ label: 'Balance', before: '2 BTC', after: '1 BTC' }]} />
            <ConfirmCostCard
                rows={[
                    { key: 'fee', label: 'Network fee', value: '0.000015 BTC', fiat: '~$0.98' },
                    { key: 'total', label: 'Total', value: '1.000015 BTC', total: true },
                ]}
            />
            <ConfirmNotice text="The network checks this before it is sent." />
        </main>
    )],
    ['ConfirmModal', () => (
        <ConfirmModal title="Delete item?" message="This cannot be undone." onConfirm={noop} onCancel={noop} />
    )],
    ['DurationSlider', () => (
        <DurationSlider coin="BTC" value="144" onChange={noop} wakeText="Ends at block 900,144, est. tomorrow" />
    )],
    ['ContactsPickerScreen', () => (
        <ContactsPickerScreen
            contacts={[{ id: 'contact-1', name: 'Alice', entries: [{ address, chain: 'bitcoin' }] }]}
            variant="small"
            onPick={noop}
            onBack={noop}
        />
    )],
    ['ContractConsentPanel', () => (
        <dl>
            <ContractConsentPanel manifest={{ status: 'declared', permissions: ['SEND'], maxTakeBps: 100 }} />
        </dl>
    )],
    ['DemoExitConfirm', () => (
        <DemoExitConfirm busy={false} error={null} onConfirm={noop} onCancel={noop} />
    )],
    ['DerivationPathCrossCheck', () => (
        <DerivationPathCrossCheck
            signerName="Ledger Nano X"
            signerKind="ledger"
            path="m/84'/0'/0'/0/0"
            address={address}
            requireExplicitConfirm
            onConfirmedChange={noop}
        />
    )],
    ['DiagnosticDetails', () => (
        <DiagnosticDetails summary="2 findings" items={['First finding', 'Second finding']} />
    )],
    ['DispenserBadge', () => withMessaging(
        <DispenserBadge chainId="bitcoin-mainnet" tick="XCHAIN" />,
    ), () => screen.findByRole('status', { name: /open dispenser/i })],
    ['DraftDiscardButton', () => (
        <DraftDiscardButton onClick={noop} label="Discard saved draft">Discard</DraftDiscardButton>
    )],
    ['EmptyStateNudge', () => (
        <EmptyStateNudge title="No tokens" body="Tokens appear here." actionLabel="Receive" onAction={noop} />
    )],
    // The protocol-fee layout: network fee, protocol fee with its pay-in-native
    // switch, and the total.
    ['DispenserExplorerCard', () => (
        <DispenserExplorerCard
            chainId="bitcoin-mainnet"
            row={{ give_tick: 'XCHAIN', give_amount: '10', give_escrow: '100', escrow_remaining: '40', source: address, timestamp: Math.floor(Date.now() / 1000) - 3600 }}
            priceLabel="0.001 BTC"
            onSelect={noop}
        />
    )],
    ['FileField', () => (
        <FileField label="File (up to 7,792 bytes)" fileName="notes.txt" onFile={noop} onClear={noop} />
    )],
    ['FeesCard', () => (
        <FeesCard
            feeSelector={<div>Network fee selector</div>}
            tiers={{
                low: { coinAmount: '0.00001' },
                normal: { coinAmount: '0.000015' },
                fast: { coinAmount: '0.00002' },
            }}
            value={{ mode: 'normal' }}
            coinTicker="BTC"
            quote={{ xchainFee: '0.064', requiredFeeSats: 197 }}
            nativeFeeProps={{ checked: false, onChange: noop }}
            fiat={{
                formatNativeFee: () => '~$0.98',
                formatProtocolFee: () => '~$0.13',
                formatFeeTotal: () => '~$1.11',
            }}
        />
    )],
    ['GatedFileViewer', () => (
        <GatedFileViewer
            name="note.txt"
            declaredType="text/plain"
            plaintextBase64="SGVsbG8sIHdhbGxldC4="
            onClose={noop}
        />
    )],
    ['HeaderActionMenu', () => (
        <HeaderActionMenu
            onMenuToggle={noop}
        />
    )],
    ['HomeFilterBar', () => (
        <HomeFilterBar
            chainRegistry={chainRegistry}
            coinFamilies={['bitcoin']}
            networkFilter="all"
            onNetworkFilterChange={noop}
            tokenQuery=""
            onTokenQueryChange={noop}
        />
    )],
    // Checked open, so the sort, search and network controls in its popover are covered.
    ['HomeListFilterMenu', () => (
        <HomeListFilterMenu
            sortBy="name"
            onSortChange={noop}
            chainRegistry={chainRegistry}
            coinFamilies={['bitcoin']}
            networkFilter="all"
            onNetworkFilterChange={noop}
            tokenQuery=""
            onTokenQueryChange={noop}
        />
    ), async () => {
        fireEvent.click(screen.getByRole('button', { name: /filter/i }));
        await screen.findByRole('dialog');
    }],
    ['HomeTabs', () => withMessaging(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={{}}
            walletId="wallet-1"
            networkFilter="all"
            coinFamilies={[]}
            onNetworkFilterChange={noop}
            onTokenQueryChange={noop}
            onReceive={noop}
        />,
    )],
    ['HwFirmwareBanner', () => (
        <HwFirmwareBanner signerInfo={{ vendor: 'unknown', model: 'Test device', firmwareVersion: '1.0.0' }} />
    )],
    ['HwSignBlock', () => (
        <HwSignBlock
            signerKind="ledger"
            signerName="Ledger Nano X"
            path="m/84'/0'/0'/0/0"
            address={address}
            chainId="bitcoin-mainnet"
            getStatus={null}
        />
    )],
    ['KeyQR', () => <KeyQR value={address} alt="Wallet address QR code" />, () => screen.findByRole('img')],
    ['LayoutModeToggle', () => <LayoutModeToggle />, () => screen.findByRole('radiogroup')],
    ['LearnNote', () => <LearnNote chainLabel="Bitcoin" />],
    ['LeftNav', () => (
        <LeftNav
            currentView="home"
            onSelect={noop}
            onLock={noop}
            onOpenSettings={noop}
        />
    )],
    ['ListPickerScreen', () => (
        <ListPickerScreen
            variant="small"
            messaging={{ getListsForSource: vi.fn(), getListByActionIndex: vi.fn() }}
            chainId="bitcoin-mainnet"
            addresses={[]}
            onSelect={noop}
            onBack={noop}
        />
    )],
    ['ListFilterMenu', () => (
        <ListFilterMenu query="" onQueryChange={noop} searchPlaceholder="Search items" searchLabel="Search items" />
    )],
    ['ListFilterPopover', () => (
        <ListFilterPopover label="Filter list"><p>Panel controls</p></ListFilterPopover>
    )],
    ['ListSearchField', () => (
        <ListSearchField value="" onChange={noop} placeholder="Search items" />
    )],
    ['ListToolbar', () => (
        <ListToolbar query="" onQueryChange={noop} searchLabel="Search items" />
    )],
    // One send that went out and one that did not while the wallet was locked.
    ['LockedSendOutcomeNotice', () => (
        <MessagingContext.Provider
            value={{
                shell: 'web',
                messaging: {
                    ...messaging,
                    listLockedSendOutcomes: vi.fn().mockResolvedValue([
                        { id: 'p1', kind: 'sent', txid: 'ab'.repeat(32), amount: '0.0003', tick: 'BTC', summary: 'Send 0.0003 BTC' },
                        { id: 'p2', kind: 'unsent', txid: null, amount: '0.0002', tick: 'BTC', summary: null },
                    ]),
                    clearLockedSendOutcomes: vi.fn().mockResolvedValue({ cleared: 2 }),
                },
            }}
        >
            <LockedSendOutcomeNotice walletId="wallet-1" routeKey="home" />
        </MessagingContext.Provider>
    ), () => screen.findByTestId('locked-send-outcome')],
    ['LockedTokenContext', () => <LockedTokenContext chainId="bitcoin-mainnet" tick="XCHAIN" />],
    ['LogConsole', () => <LogConsole />],
];

const componentModules = import.meta.glob(
    '../../../packages/core/src/shared/components/*.jsx',
);

function componentNamesAThroughL() {
    return Object.keys(componentModules)
        .map((path) => path.slice(path.lastIndexOf('/') + 1, -4))
        .filter((name) => /^[A-L]/.test(name))
        .filter((name) => name !== 'HeaderSettingsButton')
        .sort();
}

beforeEach(() => {
    clearDemoWalletId();
    markDemoWallet('demo-wallet');
    document.documentElement.setAttribute('data-xc-learn-mode', 'on');
    vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches: false,
        media: '',
        addEventListener: noop,
        removeEventListener: noop,
    })));
    vi.stubGlobal('chrome', {
        sidePanel: {},
        storage: {
            local: {
                get: (_key, callback) => callback({ 'xchain.layoutMode': 'popup' }),
                set: noop,
            },
            onChanged: { addListener: noop, removeListener: noop },
        },
    });
});

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    __clearDispenserBadgeCache();
    document.documentElement.removeAttribute('data-xc-learn-mode');
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('shared components A through L accessibility', () => {
    it('accounts for every A through L component module', () => {
        expect(fixtures.map(([name]) => name).sort()).toEqual(componentNamesAThroughL());
    });

    it.each(fixtures)('%s has no serious or critical axe violations', async (_name, component, ready) => {
        const { container } = render(component());
        if (ready) await ready();
        await expectNoSeriousAxeViolations(container);
    });
});
