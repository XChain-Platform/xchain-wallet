// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { registry as registryLib } from '@xchain-wallet/core';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { markDemoWallet, clearDemoWalletId } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { ActionIntentSummary } from '../../../packages/core/src/shared/components/ActionIntentSummary.jsx';
import { AdsNotice } from '../../../packages/core/src/shared/components/AdsNotice.jsx';
import { AlertsOverlay } from '../../../packages/core/src/shared/components/AlertsOverlay.jsx';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { BackupReminderCard } from '../../../packages/core/src/shared/components/BackupReminderCard.jsx';
import { BalanceChanges } from '../../../packages/core/src/shared/components/BalanceChanges.jsx';
import { BalanceList } from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { CollectiblesView } from '../../../packages/core/src/shared/components/CollectiblesView.jsx';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import { ConfirmModal } from '../../../packages/core/src/shared/components/ConfirmModal.jsx';
import { ContactsPickerScreen } from '../../../packages/core/src/shared/components/ContactsPickerScreen.jsx';
import { ContractConsentPanel } from '../../../packages/core/src/shared/components/ContractConsentPanel.jsx';
import { DemoBanner } from '../../../packages/core/src/shared/components/DemoBanner.jsx';
import { DemoExitConfirm } from '../../../packages/core/src/shared/components/DemoExitConfirm.jsx';
import { DerivationPathCrossCheck } from '../../../packages/core/src/shared/components/DerivationPathCrossCheck.jsx';
import { DiagnosticDetails } from '../../../packages/core/src/shared/components/DiagnosticDetails.jsx';
import { DispenserBadge, __clearDispenserBadgeCache } from '../../../packages/core/src/shared/components/DispenserBadge.jsx';
import { DraftDiscardButton } from '../../../packages/core/src/shared/components/DraftDiscardButton.jsx';
import { EmptyStateNudge } from '../../../packages/core/src/shared/components/EmptyStateNudge.jsx';
import { GatedFileViewer } from '../../../packages/core/src/shared/components/GatedFileViewer.jsx';
import { HeaderSettingsButton } from '../../../packages/core/src/shared/components/HeaderSettingsButton.jsx';
import { HomeFilterBar } from '../../../packages/core/src/shared/components/HomeFilterBar.jsx';
import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { HwFirmwareBanner } from '../../../packages/core/src/shared/components/HwFirmwareBanner.jsx';
import { HwSignBlock } from '../../../packages/core/src/shared/components/HwSignBlock.jsx';
import { KeyQR } from '../../../packages/core/src/shared/components/KeyQR.jsx';
import { LayoutModeToggle } from '../../../packages/core/src/shared/components/LayoutModeToggle.jsx';
import { LearnNote } from '../../../packages/core/src/shared/components/LearnNote.jsx';
import { LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ListPickerScreen } from '../../../packages/core/src/shared/components/ListPickerScreen.jsx';
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
    ['AdsNotice', () => <AdsNotice onContinue={noop} isFull />],
    ['AlertsOverlay', () => (
        <AlertsOverlay
            alerts={[{
                id: 'backup',
                severity: 'warning',
                title: 'Back up your wallet',
                message: 'Save a recovery copy.',
                action: { label: 'Review backup', onSelect: noop },
            }]}
            onClose={noop}
        />
    )],
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
            onMenuOpen={noop}
            onScan={noop}
            onCommandPalette={noop}
            onLock={noop}
            activeNetwork="mainnet"
        />
    )],
    ['BackupReminderCard', () => (
        <BackupReminderCard walletId="wallet-1" walletCreatedAt="2025-01-01T00:00:00.000Z" onAction={noop} />
    )],
    ['BalanceChanges', () => (
        <BalanceChanges result={{ deltas: [{ tick: 'BTC', before: '2', after: '1' }] }} />
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
    ['BottomTabBar', () => (
        <BottomTabBar currentView="home" onSelect={noop} onLock={noop} onOpenSettings={noop} />
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
    ['ConfirmModal', () => (
        <ConfirmModal title="Delete item?" message="This cannot be undone." onConfirm={noop} onCancel={noop} />
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
    ['DemoBanner', () => withMessaging(<DemoBanner activeWalletId="demo-wallet" />)],
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
    ['GatedFileViewer', () => (
        <GatedFileViewer
            name="note.txt"
            declaredType="text/plain"
            plaintextBase64="SGVsbG8sIHdhbGxldC4="
            onClose={noop}
        />
    )],
    ['HeaderSettingsButton', () => (
        <HeaderSettingsButton
            activeWallet={{ id: 'wallet-1', name: 'Primary wallet' }}
            activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
            onOpenWalletPicker={noop}
            onOpenAccountPicker={noop}
            activeNetwork="mainnet"
            onActiveNetworkChange={noop}
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
            walletName="Primary wallet"
            onOpenWalletPicker={noop}
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
